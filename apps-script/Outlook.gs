/**
 * Outlook.gs — brings your Outlook calendar into the Command Center.
 * =================================================================
 * Busy times only. No subjects, no attendees, no locations — nothing that
 * identifies a meeting ever leaves Outlook. Only "you are busy 10:00–11:00".
 *
 * Two ways in, both landing in the same `Outlook` tab:
 *
 *   Route A — Published calendar link
 *     Outlook Web gives you a secret .ics URL. This script fetches it on an
 *     hourly trigger. Set it up with: Command Center > Connect Outlook calendar
 *
 *   Route B — Power Automate
 *     A flow POSTs events to your Web App URL with action 'outlookPush'.
 *     No public link involved. See OUTLOOK-SYNC.md.
 *
 * Your painted availability is never overwritten. Outlook busy time is a
 * separate layer the site draws underneath what you set by hand.
 */

var SH_OUT = 'Outlook';
var OUT_COLS = ['uid', 'date', 'start', 'end', 'allDay', 'source', 'updatedAt'];

/* Wall-clock timezone for the grid. Keep in step with config.js timezoneLabel. */
var TIMEZONE = 'Asia/Kolkata';

/* How far around today to keep in sync. */
var SYNC_BACK_DAYS = 30;
var SYNC_FWD_DAYS  = 120;

/* ====================================================================== */
/*  SETUP / MENU ACTIONS                                                  */
/* ====================================================================== */

function connectOutlook() {
  var ui, url;
  try {
    ui = SpreadsheetApp.getUi();
    var r = ui.prompt('Connect Outlook',
      'Paste the ICS link from Outlook Web:\n\n' +
      'Outlook on the web > Settings (gear) > Calendar > Shared calendars >\n' +
      'Publish a calendar > pick your calendar > permission "Can view when I am busy" >\n' +
      'Publish, then copy the ICS link.\n\n' +
      'Leave blank and press OK to disconnect.',
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    url = r.getResponseText().trim();
  } catch (e) { return; }

  var props = PropertiesService.getScriptProperties();
  if (!url) {
    props.deleteProperty('OUTLOOK_ICS_URL');
    try { SpreadsheetApp.getUi().alert('Outlook disconnected. Existing rows are left in place; ' +
      'clear them with Command Center > Clear Outlook data.'); } catch (e) {}
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    try { SpreadsheetApp.getUi().alert('That does not look like a link. It should start with https://'); } catch (e) {}
    return;
  }
  /* Outlook sometimes hands you the webcal:// or .html form — normalise. */
  url = url.replace(/^webcal:/i, 'https:').replace(/\.html(\?|$)/i, '.ics$1');
  props.setProperty('OUTLOOK_ICS_URL', url);
  syncOutlookNow();
}

function syncOutlookNow() {
  var url = PropertiesService.getScriptProperties().getProperty('OUTLOOK_ICS_URL');
  if (!url) {
    try { SpreadsheetApp.getUi().alert('No Outlook link set. Use Command Center > Connect Outlook calendar.'); } catch (e) {}
    return;
  }
  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  } catch (err) {
    return outlookFail('Could not reach that link: ' + err);
  }
  if (res.getResponseCode() !== 200) {
    return outlookFail('Outlook returned HTTP ' + res.getResponseCode() +
      '. The link may have expired — republish the calendar and reconnect.');
  }
  var body = res.getContentText();
  if (body.indexOf('BEGIN:VCALENDAR') === -1) {
    return outlookFail('That link did not return a calendar file. Make sure you copied the ICS link, not the HTML one.');
  }
  var rows;
  try {
    rows = icsToRows(body, 'ics');
  } catch (err) {
    return outlookFail('Could not read the calendar: ' + err);
  }
  writeOutlookRows(rows, 'ics');
  var msg = 'Outlook synced: ' + rows.length + ' busy blocks in the next ' + SYNC_FWD_DAYS + ' days.';
  PropertiesService.getScriptProperties().setProperty('OUTLOOK_LAST', new Date().toISOString());
  PropertiesService.getScriptProperties().setProperty('OUTLOOK_STATUS', msg);
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}
function outlookFail(msg) {
  PropertiesService.getScriptProperties().setProperty('OUTLOOK_STATUS', 'Last attempt failed — ' + msg);
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/** Silent version for the hourly trigger. */
function syncOutlookTrigger() {
  try { syncOutlookNow(); } catch (e) { Logger.log('outlook trigger failed: ' + e); }
}

function enableHourlyOutlookSync() {
  removeOutlookTriggers();
  ScriptApp.newTrigger('syncOutlookTrigger').timeBased().everyHours(1).create();
  var m = 'Hourly Outlook sync is on. It will also run whenever you press Sync Outlook now.';
  Logger.log(m); try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
}
function disableHourlyOutlookSync() {
  removeOutlookTriggers();
  var m = 'Hourly Outlook sync is off.';
  Logger.log(m); try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
}
function removeOutlookTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncOutlookTrigger') ScriptApp.deleteTrigger(t);
  });
}
function clearOutlookData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureSheet(ss, SH_OUT, OUT_COLS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, OUT_COLS.length).clearContent();
  var m = 'Outlook data cleared.';
  Logger.log(m); try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
}
function outlookStatus() {
  var p = PropertiesService.getScriptProperties();
  return { connected: !!p.getProperty('OUTLOOK_ICS_URL'),
           last: p.getProperty('OUTLOOK_LAST') || '',
           status: p.getProperty('OUTLOOK_STATUS') || '',
           hourly: ScriptApp.getProjectTriggers().some(function (t) {
             return t.getHandlerFunction() === 'syncOutlookTrigger'; }),
           count: Math.max(0, sheet(SH_OUT).getLastRow() - 1) };
}

/* ====================================================================== */
/*  ICS PARSING                                                           */
/* ====================================================================== */

/** Undoes RFC 5545 line folding. */
function icsUnfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/** Splits "DTSTART;TZID=X:20260814T090000" into {name, params, value}. */
function icsLine(line) {
  var c = line.indexOf(':');
  if (c === -1) return null;
  var left = line.slice(0, c), value = line.slice(c + 1);
  var bits = left.split(';');
  var params = {};
  for (var i = 1; i < bits.length; i++) {
    var eq = bits[i].indexOf('=');
    if (eq > -1) params[bits[i].slice(0, eq).toUpperCase()] = bits[i].slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: bits[0].toUpperCase(), params: params, value: value };
}

/**
 * Turns an ICS date-time into { ms, allDay }.
 *   20260814T093000Z          -> exact UTC instant
 *   TZID=...:20260814T093000  -> wall clock, assumed to be TIMEZONE
 *   VALUE=DATE:20260814       -> all day
 */
function icsWhen(prop) {
  var v = String(prop.value).trim();
  var m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3], h = +(m[4] || 0), mi = +(m[5] || 0), s = +(m[6] || 0);
  var isDate = prop.params.VALUE === 'DATE' || !m[4];
  if (isDate) {
    return { ms: dateInTz(y, mo, d, 0, 0), allDay: true };
  }
  if (m[7] === 'Z') return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false };
  /* floating or TZID — treat the wall clock as TIMEZONE */
  return { ms: dateInTz(y, mo, d, h, mi), allDay: false };
}

/** Milliseconds for a wall-clock time in TIMEZONE. */
function dateInTz(y, mo, d, h, mi) {
  var guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  /* Find the offset TIMEZONE had at that moment, then correct. */
  var probe = new Date(guess);
  var shown = Utilities.formatDate(probe, TIMEZONE, "yyyy-MM-dd'T'HH:mm");
  var p = shown.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!p) return guess;
  var shownMs = Date.UTC(+p[1], +p[2] - 1, +p[3], +p[4], +p[5]);
  return guess - (shownMs - guess);
}
function tzDateStr(ms) { return Utilities.formatDate(new Date(ms), TIMEZONE, 'yyyy-MM-dd'); }
function tzTimeStr(ms) { return Utilities.formatDate(new Date(ms), TIMEZONE, 'HH:mm'); }

var DAY_MS = 86400000;
var BYDAY_NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Expands an RRULE into start instants, bounded by the sync window. */
function expandRule(startMs, rule, exDates, windowEnd) {
  var out = [startMs];
  if (!rule) return out;
  var parts = {};
  String(rule).split(';').forEach(function (kv) {
    var e = kv.indexOf('=');
    if (e > -1) parts[kv.slice(0, e).toUpperCase()] = kv.slice(e + 1);
  });
  var freq = (parts.FREQ || '').toUpperCase();
  if (!freq) return out;
  var interval = Math.max(1, parseInt(parts.INTERVAL || '1', 10));
  var count = parts.COUNT ? parseInt(parts.COUNT, 10) : null;
  var until = null;
  if (parts.UNTIL) {
    var u = icsWhen({ value: parts.UNTIL, params: {} });
    if (u) until = u.ms;
  }
  var byday = parts.BYDAY ? String(parts.BYDAY).split(',').map(function (x) {
    return x.replace(/^[-+]?\d+/, '').toUpperCase();
  }) : null;

  var limit = Math.min(until || windowEnd, windowEnd);
  var made = 1, guard = 0;
  var cursor = startMs;
  var base = new Date(startMs);

  if (freq === 'WEEKLY' && byday && byday.length) {
    /* walk week by week, emitting each requested weekday */
    var weekStart = startMs - ((new Date(startMs)).getUTCDay()) * DAY_MS;
    out = [];
    var wk = 0;
    while (guard++ < 800) {
      var anchor = weekStart + wk * interval * 7 * DAY_MS;
      if (anchor > limit + 7 * DAY_MS) break;
      for (var i = 0; i < byday.length; i++) {
        var dow = BYDAY_NUM[byday[i]];
        if (dow === undefined) continue;
        var t = anchor + dow * DAY_MS;
        if (t < startMs) continue;
        if (t > limit) continue;
        out.push(t);
        if (count && out.length >= count) return dedupe(out, exDates);
      }
      wk++;
    }
    return dedupe(out, exDates);
  }

  while (guard++ < 800) {
    if (freq === 'DAILY')        cursor = startMs + made * interval * DAY_MS;
    else if (freq === 'WEEKLY')  cursor = startMs + made * interval * 7 * DAY_MS;
    else if (freq === 'MONTHLY') {
      var dm = new Date(startMs);
      cursor = Date.UTC(dm.getUTCFullYear(), dm.getUTCMonth() + made * interval, dm.getUTCDate(),
                        dm.getUTCHours(), dm.getUTCMinutes());
    } else if (freq === 'YEARLY') {
      var dy = new Date(startMs);
      cursor = Date.UTC(dy.getUTCFullYear() + made * interval, dy.getUTCMonth(), dy.getUTCDate(),
                        dy.getUTCHours(), dy.getUTCMinutes());
    } else break;
    if (cursor > limit) break;
    out.push(cursor);
    made++;
    if (count && out.length >= count) break;
  }
  void base;
  return dedupe(out, exDates);
}
function dedupe(list, exDates) {
  var seen = {}, ex = {}, out = [];
  (exDates || []).forEach(function (e) { ex[tzDateStr(e) + 'T' + tzTimeStr(e)] = 1; ex[tzDateStr(e)] = 1; });
  list.forEach(function (t) {
    var k = tzDateStr(t) + 'T' + tzTimeStr(t);
    if (seen[k] || ex[k] || ex[tzDateStr(t)]) return;
    seen[k] = 1; out.push(t);
  });
  return out;
}

/**
 * ICS text -> busy rows, one per date an event covers.
 * Skips: cancelled, free/transparent, and anything outside the sync window.
 */
function icsToRows(text, source) {
  var lines = icsUnfold(text).split('\n');
  var now = Date.now();
  var winStart = now - SYNC_BACK_DAYS * DAY_MS;
  var winEnd = now + SYNC_FWD_DAYS * DAY_MS;
  var rows = [], ev = null;

  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (!raw) continue;
    if (raw.indexOf('BEGIN:VEVENT') === 0) { ev = { ex: [] }; continue; }
    if (raw.indexOf('END:VEVENT') === 0) {
      if (ev) rowsFromEvent(ev, rows, winStart, winEnd, source);
      ev = null;
      continue;
    }
    if (!ev) continue;
    var p = icsLine(raw);
    if (!p) continue;
    switch (p.name) {
      case 'UID':      ev.uid = p.value; break;
      case 'DTSTART':  ev.start = icsWhen(p); break;
      case 'DTEND':    ev.end = icsWhen(p); break;
      case 'DURATION': ev.duration = p.value; break;
      case 'RRULE':    ev.rrule = p.value; break;
      case 'EXDATE':
        String(p.value).split(',').forEach(function (v) {
          var w = icsWhen({ value: v.trim(), params: p.params });
          if (w) ev.ex.push(w.ms);
        });
        break;
      case 'STATUS':   ev.status = p.value.toUpperCase(); break;
      case 'TRANSP':   ev.transp = p.value.toUpperCase(); break;
      case 'X-MICROSOFT-CDO-BUSYSTATUS': ev.busyStatus = p.value.toUpperCase(); break;
      case 'X-MICROSOFT-CDO-ALLDAYEVENT': ev.msAllDay = p.value.toUpperCase() === 'TRUE'; break;
    }
  }
  return rows;
}

function rowsFromEvent(ev, rows, winStart, winEnd, source) {
  if (!ev.start) return;
  if (ev.status === 'CANCELLED') return;
  if (ev.transp === 'TRANSPARENT') return;
  if (ev.busyStatus === 'FREE') return;

  var durMs = 0;
  if (ev.end) durMs = ev.end.ms - ev.start.ms;
  else if (ev.duration) durMs = isoDurationMs(ev.duration);
  if (!durMs || durMs < 0) durMs = ev.start.allDay ? DAY_MS : 30 * 60000;

  var allDay = !!(ev.start.allDay || ev.msAllDay);
  var starts = expandRule(ev.start.ms, ev.rrule, ev.ex, winEnd);

  starts.forEach(function (s) {
    var e = s + durMs;
    if (e < winStart || s > winEnd) return;
    /* split across day boundaries so each row belongs to one date */
    var cur = s, guard = 0;
    while (cur < e && guard++ < 40) {
      var dateStr = tzDateStr(cur);
      var dayEndMs = dateInTz(+dateStr.slice(0, 4), +dateStr.slice(5, 7), +dateStr.slice(8, 10), 0, 0) + DAY_MS;
      var segEnd = Math.min(e, dayEndMs);
      var st = allDay ? '00:00' : tzTimeStr(cur);
      var en = allDay ? '23:59' : (segEnd >= dayEndMs ? '23:59' : tzTimeStr(segEnd));
      if (st !== en) {
        rows.push({ uid: (ev.uid || 'evt') + '|' + dateStr + '|' + st,
                    date: dateStr, start: st, end: en, allDay: allDay ? 'yes' : '', source: source });
      }
      cur = segEnd;
    }
  });
}
function isoDurationMs(d) {
  var m = String(d).match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return 0;
  return ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) * 1000;
}

/* ====================================================================== */
/*  WRITING                                                               */
/* ====================================================================== */

/** Replaces every row in the sync window from this source, then appends. */
function writeOutlookRows(rows, source) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ensureSheet(ss, SH_OUT, OUT_COLS);
  var now = Date.now();
  var from = tzDateStr(now - SYNC_BACK_DAYS * DAY_MS);
  var to   = tzDateStr(now + SYNC_FWD_DAYS * DAY_MS);

  var last = sh.getLastRow();
  if (last > 1) {
    var vals = sh.getRange(2, 1, last - 1, OUT_COLS.length).getDisplayValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      var d = String(vals[i][1]).slice(0, 10), src = String(vals[i][5] || '');
      if (d >= from && d <= to && (!source || src === source)) sh.deleteRow(i + 2);
    }
  }
  if (!rows.length) return 0;
  var stamp = new Date().toISOString();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, OUT_COLS.length).setValues(rows.map(function (r) {
    return [r.uid, r.date, r.start, r.end, r.allDay || '', r.source || source || '', stamp];
  }));
  sortByCol(sh, 2);
  return rows.length;
}

function readOutlook() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SH_OUT)) return [];
  var t = readTable(SH_OUT), mk = reader(t), out = [];
  t.rows.forEach(function (r) {
    var g = mk(r), date = asDate(g('date'));
    if (!date) return;
    out.push({ date: date, start: asTime(g('start')) || '00:00', end: asTime(g('end')) || '23:59',
               allDay: !!g('allDay'), source: g('source') });
  });
  return out;
}

/**
 * Route B — Power Automate posts here.
 * payload: { events: [ { uid, start, end, allDay } ] } with ISO date-times.
 */
function outlookPush(payload) {
  var evs = (payload && payload.events) || [];
  var rows = [];
  var now = Date.now();
  var winStart = now - SYNC_BACK_DAYS * DAY_MS;
  var winEnd = now + SYNC_FWD_DAYS * DAY_MS;
  evs.forEach(function (e) {
    var s = Date.parse(e.start), en = Date.parse(e.end);
    if (isNaN(s)) return;
    if (isNaN(en) || en <= s) en = s + 30 * 60000;
    if (en < winStart || s > winEnd) return;
    var allDay = !!e.allDay;
    var cur = s, guard = 0;
    while (cur < en && guard++ < 40) {
      var dateStr = tzDateStr(cur);
      var dayEndMs = dateInTz(+dateStr.slice(0, 4), +dateStr.slice(5, 7), +dateStr.slice(8, 10), 0, 0) + DAY_MS;
      var segEnd = Math.min(en, dayEndMs);
      var st = allDay ? '00:00' : tzTimeStr(cur);
      var fin = allDay ? '23:59' : (segEnd >= dayEndMs ? '23:59' : tzTimeStr(segEnd));
      if (st !== fin) {
        rows.push({ uid: (e.uid || 'flow') + '|' + dateStr + '|' + st,
                    date: dateStr, start: st, end: fin, allDay: allDay ? 'yes' : '', source: 'flow' });
      }
      cur = segEnd;
    }
  });
  writeOutlookRows(rows, 'flow');
  PropertiesService.getScriptProperties().setProperty('OUTLOOK_LAST', new Date().toISOString());
  PropertiesService.getScriptProperties().setProperty('OUTLOOK_STATUS',
    'Power Automate pushed ' + rows.length + ' busy blocks.');
  return rows.length;
}
