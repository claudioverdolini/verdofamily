const props = PropertiesService.getScriptProperties();

function doGet() {
  return json_({ ok: true, app: 'VerdoFamily', endpoint: 'backup-webhook' });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = props.getProperty('VERDOFAMILY_WEBHOOK_SECRET') || '';
    if (!secret || payload.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

    if (payload.type === 'health_attachment') return saveHealthAttachment_(payload);
    return saveFamilyBackup_(payload);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function saveFamilyBackup_(payload) {
  if (!payload.familyId || !payload.data) return json_({ ok: false, error: 'invalid_payload' });
  const folderId = props.getProperty('VERDOFAMILY_BACKUP_FOLDER_ID');
  if (!folderId) return json_({ ok: false, error: 'backup_folder_not_configured' });
  const folder = DriveApp.getFolderById(folderId);
  const stamp = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd_HH-mm-ss');
  const family = safe_(payload.familyName || payload.familyId || 'Famiglia');
  const revision = Number(payload.revision || 0);
  const fileName = `VerdoFamily_${family}_${stamp}_rev${revision}.json`;
  const file = folder.createFile(fileName, JSON.stringify(payload, null, 2), MimeType.PLAIN_TEXT);
  return json_({ ok: true, fileId: file.getId(), fileName: file.getName(), type: 'family_backup' });
}

function saveHealthAttachment_(payload) {
  if (!payload.familyId || !payload.fileName || !payload.contentBase64) return json_({ ok: false, error: 'invalid_attachment_payload' });
  const folderKey = payload.category === 'visit'
    ? 'VERDOFAMILY_HEALTH_VISITS_FOLDER_ID'
    : payload.category === 'therapy'
      ? 'VERDOFAMILY_HEALTH_THERAPIES_FOLDER_ID'
      : 'VERDOFAMILY_HEALTH_RECORDS_FOLDER_ID';
  const folderId = props.getProperty(folderKey);
  if (!folderId) return json_({ ok: false, error: 'health_folder_not_configured' });
  const folder = DriveApp.getFolderById(folderId);
  const bytes = Utilities.base64Decode(payload.contentBase64);
  const mime = payload.mimeType || 'application/octet-stream';
  const stamp = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');
  const person = safe_(payload.personName || 'Famiglia');
  const title = safe_(payload.recordTitle || 'Documento');
  const original = safeFile_(payload.fileName);
  const fileName = `${stamp}_${person}_${title}_${original}`;
  const blob = Utilities.newBlob(bytes, mime, fileName);
  const file = folder.createFile(blob);
  if (payload.description) file.setDescription(String(payload.description).slice(0, 5000));
  return json_({ ok: true, fileId: file.getId(), fileName: file.getName(), type: 'health_attachment' });
}

function safe_(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'Documento';
}

function safeFile_(value) {
  return String(value || 'allegato')
    .replace(/[\\/:*?\"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(-120);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
