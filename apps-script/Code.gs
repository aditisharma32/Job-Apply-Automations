/**
 * Apps Script web app for the job-apply-automation tracking sheet.
 *
 * Sheet header row (row 1), any order:
 *   Date | Company | Title | Location | Domain | HR Email | Status | Source | Message ID | Notes
 *
 * Deploy: Deploy > New deployment > Web app, Execute as = Me,
 * Who has access = Anyone. Put the /exec URL in SHEET_API.
 * After editing this file: Deploy > Manage deployments > Edit > new version.
 *
 * Optional shared token: set TOKEN below and SHEET_API_TOKEN in the app.
 */
var TOKEN = '1LcWpmbwuY3zZhz5adGgxeIRYSG2yapuUbIlwFlqrsBM';

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
}

function checkToken_(e, body) {
  if (!TOKEN) return true;
  var t = (e && e.parameter && e.parameter.token) || (body && body.token) || '';
  return t === TOKEN;
}

function doGet(e) {
  try {
    if (!checkToken_(e, null)) return json_({ success: false, error: 'unauthorized' });
    var data = sheet_().getDataRange().getValues();
    if (data.length < 2) return json_({ success: true, count: 0, data: [] });
    var headers = data[0];
    var rows = data.slice(1)
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); })
      .map(function (r) {
        var o = {};
        headers.forEach(function (h, i) { o[h] = r[i]; });
        return o;
      });
    return json_({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!checkToken_(e, body)) return json_({ success: false, error: 'unauthorized' });

    var action = body.action;
    var sheet = sheet_();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];

    if (action === 'append') {
      var row = body.row || {};
      var out = headers.map(function (h) { return row[h] != null ? row[h] : ''; });
      sheet.appendRow(out);
      return json_({ success: true, appended: true, row: sheet.getLastRow() });
    }

    if (action === 'updateStatus') {
      var match = body.match || {};
      var statusCol = headers.indexOf('Status');
      var notesCol = headers.indexOf('Notes');
      if (statusCol === -1) return json_({ success: false, error: 'Status column not found' });

      var matchKeys = Object.keys(match);
      var updated = 0;
      for (var i = 1; i < data.length; i++) {
        var ok = matchKeys.every(function (k) {
          var col = headers.indexOf(k);
          if (col === -1) return false;
          return String(data[i][col]).trim().toLowerCase() === String(match[k]).trim().toLowerCase();
        });
        if (!ok) continue;
        sheet.getRange(i + 1, statusCol + 1).setValue(body.status);
        if (notesCol !== -1 && body.notes) sheet.getRange(i + 1, notesCol + 1).setValue(body.notes);
        updated++;
      }
      return json_({ success: true, updated: updated });
    }

    return json_({ success: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json_({ success: false, error: String(err) });
  }
}
