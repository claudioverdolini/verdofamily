from pathlib import Path

p = Path('pages/ShoppingPantry.tsx')
s = p.read_text()
s = s.replace("import { Camera, Check, ChevronRight, PackageOpen, Plus, ScanLine, Search, ShoppingBasket, Trash2 } from 'lucide-react'", "import { Camera, Check, ChevronRight, PackageOpen, Plus, ScanLine, Search, ShoppingBasket, Trash2, Upload } from 'lucide-react'")

old_receipt = '''            <label className="receipt-drop">\n              <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) runOcr(file) }} />\n              <Camera size={32} />\n              <strong>Scatta o carica una foto</strong>\n              <span>Meglio se dritta, nitida e ben illuminata.</span>\n            </label>'''
new_receipt = '''            <div className="image-source-grid">\n              <label className="image-source-option">\n                <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) runOcr(file); e.currentTarget.value = '' }} />\n                <Camera size={28} />\n                <strong>Scatta foto</strong>\n                <span>Apri direttamente la fotocamera.</span>\n              </label>\n              <label className="image-source-option">\n                <input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) runOcr(file); e.currentTarget.value = '' }} />\n                <Upload size={28} />\n                <strong>Scegli foto esistente</strong>\n                <span>Apri galleria, Foto o File del dispositivo.</span>\n              </label>\n            </div>\n            <div className="image-source-hint">Meglio se la foto è dritta, nitida e ben illuminata.</div>'''
if old_receipt not in s:
    raise SystemExit('receipt picker block not found')
s = s.replace(old_receipt, new_receipt, 1)

old_pantry = '''              <label className="receipt-drop pantry-photo-drop">\n                <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) void selectPantryPhoto(file); e.currentTarget.value = '' }} />\n                {photoPreview ? <img src={photoPreview} alt="Foto dispensa da analizzare" /> : <Camera size={38} />}\n                <strong>{photoPreview ? 'Cambia foto' : 'Scatta o carica una foto'}</strong>\n                <span>Per risultati migliori: foto frontale, luce uniforme e prodotti non troppo sovrapposti.</span>\n              </label>'''
new_pantry = '''              {photoPreview ? <div className="pantry-photo-preview"><img src={photoPreview} alt="Foto dispensa da analizzare" /><span>Foto pronta per il riconoscimento</span></div> : null}\n              <div className="image-source-grid image-source-grid--pantry">\n                <label className="image-source-option">\n                  <input type="file" accept="image/*" capture="environment" onChange={e => { const file = e.target.files?.[0]; if (file) void selectPantryPhoto(file); e.currentTarget.value = '' }} />\n                  <Camera size={30} />\n                  <strong>{photoPreview ? 'Scatta un’altra foto' : 'Scatta foto'}</strong>\n                  <span>Usa la fotocamera del tablet o telefono.</span>\n                </label>\n                <label className="image-source-option">\n                  <input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) void selectPantryPhoto(file); e.currentTarget.value = '' }} />\n                  <Upload size={30} />\n                  <strong>{photoPreview ? 'Scegli un’altra foto' : 'Scegli foto esistente'}</strong>\n                  <span>Apri galleria, Foto o File del dispositivo.</span>\n                </label>\n              </div>\n              <div className="image-source-hint">Per risultati migliori: foto frontale, luce uniforme e prodotti non troppo sovrapposti.</div>'''
if old_pantry not in s:
    raise SystemExit('pantry picker block not found')
s = s.replace(old_pantry, new_pantry, 1)
p.write_text(s)

css = Path('responsive.css')
c = css.read_text()
marker = '/* Camera + gallery chooser */'
if marker not in c:
    c += r'''

/* Camera + gallery chooser */
.image-source-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 10px 0 8px;
}
.image-source-option {
  position: relative;
  min-height: 118px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-soft, rgba(127,127,127,.05));
  cursor: pointer;
  text-align: center;
  transition: border-color .16s ease, transform .16s ease, background .16s ease;
}
.image-source-option:hover { border-color: var(--accent); transform: translateY(-1px); }
.image-source-option input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.image-source-option svg { color: var(--accent); }
.image-source-option strong { font-size: 13px; }
.image-source-option span, .image-source-hint, .pantry-photo-preview span { color: var(--muted); font-size: 10px; line-height: 1.4; }
.image-source-hint { margin-bottom: 12px; text-align: center; }
.pantry-photo-preview { display: grid; gap: 7px; margin: 10px 0 12px; }
.pantry-photo-preview img { width: 100%; max-height: 300px; object-fit: contain; border-radius: 16px; border: 1px solid var(--border); background: var(--surface-soft, rgba(127,127,127,.05)); }
.pantry-photo-preview span { text-align: center; }
@media (max-width: 640px) {
  .image-source-grid { grid-template-columns: 1fr; }
  .image-source-option { min-height: 96px; }
}
'''
css.write_text(c)
