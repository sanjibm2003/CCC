/* =========================================================================
   Channel Command Center — v17  (built 2026-08-14)
   -------------------------------------------------------------------------
   CONFIG — the only file you need to edit.
   Nothing here is secret; your access token is never stored in this file.
   ========================================================================= */
window.SITE_CONFIG = {

  /* --- who this workspace belongs to -------------------------------- */
  ownerName:  'Sanjib Mondal',
  ownerRole:  'Channel Systems Engineer · Veeam Software',
  ownerEmail: 's.mondal@veeam.com',
  timezoneLabel: 'IST (UTC +5:30)',

  /* --- Google Sheet backend ----------------------------------------
     Paste the Apps Script Web App URL here after deploying it.
     Must end in /exec.  See apps-script/SETUP.md                      */
  apiUrl: 'https://script.google.com/macros/s/AKfycbynma3mKI3sNWvPlEZFXBm-FxeD_lTjwQ396Qi7ihnGCJN9zKK5169n6CXBu1Z430V3/exec',

  /* --- availability grid ------------------------------------------- */
  dayStart: '09:00',
  dayEnd:   '18:00',       // grid runs up to but not including this
  slotMinutes: 30,
  showWeekends: false,

  /* --- how long an untimed activity is assumed to have taken --------
     Used only for the "Where my time goes" panel. Add real start and
     end times as you log new work and the estimate stops mattering.   */
  defaultActivityMinutes: 60,

  /* --- availability -------------------------------------------------
     Your weekly template is stored in this browser, not the Sheet, so it can
     differ per device. Edit it from Availability > Edit usual week.          */

  /* --- pipeline hygiene -------------------------------------------- */
  staleDays: 30,           // open opportunity with nothing logged this long gets flagged

  /* --- quarters ----------------------------------------------------
     1 = Q1 starts in January. Change if your fiscal year differs.     */
  firstMonthOfQ1: 1
};
