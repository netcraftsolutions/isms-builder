'use strict'
const { createTestDataDir, removeTestDataDir } = require('./setup/testEnv')
const { loginAs, authedGet, authedPut } = require('./setup/authHelper')

// Reale Control-IDs aus dem soaStore-Seed (BSI – immer vorhanden)
const CTRL_1 = 'BSI-ISMS.1'
const CTRL_2 = 'BSI-ORP.1'

let dataDir, app, readerCookie, editorCookie

beforeAll(async () => {
  dataDir = createTestDataDir()
  // soa.json als leeres Objekt — soaStore baut seinen Seed automatisch auf

  process.env.DATA_DIR        = dataDir
  process.env.JWT_SECRET      = 'jest-test-secret-soa'
  process.env.NODE_ENV        = 'test'
  process.env.STORAGE_BACKEND = 'json'
  app = require('../server/index.js')

  readerCookie = await loginAs(app, 'reader')
  editorCookie = await loginAs(app, 'editor')
})

afterAll(() => removeTestDataDir(dataDir))

describe('SoA – Lesen', () => {
  test('GET /soa – gibt alle Controls zurück', async () => {
    const res = await authedGet(app, readerCookie, '/soa')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(2)
  })

  test('GET /soa?framework=BSI – Filter funktioniert', async () => {
    const res = await authedGet(app, readerCookie, '/soa?framework=BSI')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body.every(c => c.framework === 'BSI')).toBe(true)
  })

  test('GET /soa/summary – gibt Zusammenfassung', async () => {
    const res = await authedGet(app, readerCookie, '/soa/summary')
    expect(res.status).toBe(200)
  })

  test('GET /soa/frameworks – gibt Framework-Liste', async () => {
    const res = await authedGet(app, readerCookie, '/soa/frameworks')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  test('GET /soa/export – JSON-Export', async () => {
    const res = await authedGet(app, readerCookie, '/soa/export')
    expect(res.status).toBe(200)
  })

  // ── Czech NIS2 (Czech-fork-specific) ─────────────────────────────────
  // Verifies that both Czech NIS2 regimes (zákon č. 264/2025 Sb.) seed
  // with the expected control counts and § numbering, and appear in the
  // framework picker.

  test('Czech NIS2 — vyšší regime exposes 25 controls (13 org + 12 tech)', async () => {
    const res = await authedGet(app, readerCookie, '/soa?framework=CZNIS2V')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(25)
    expect(res.body.every(c => c.framework === 'CZNIS2V')).toBe(true)
    const org  = res.body.filter(c => c.id.startsWith('CZNIS2V-O.'))
    const tech = res.body.filter(c => c.id.startsWith('CZNIS2V-T.'))
    expect(org.length).toBe(13)
    expect(tech.length).toBe(12)
    // Vyšší-only opatření must be present: §22 (T.7), §23 (T.8), §27 (T.12)
    const ids = res.body.map(c => c.id)
    expect(ids).toContain('CZNIS2V-T.7')
    expect(ids).toContain('CZNIS2V-T.8')
    expect(ids).toContain('CZNIS2V-T.12')
  })

  test('Czech NIS2 — nižší regime exposes 22 controls (skips §22, §23, §27)', async () => {
    const res = await authedGet(app, readerCookie, '/soa?framework=CZNIS2N')
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(22)
    expect(res.body.every(c => c.framework === 'CZNIS2N')).toBe(true)
    const ids = res.body.map(c => c.id)
    // The 3 vyšší-only opatření must NOT appear in nižší regime
    expect(ids).not.toContain('CZNIS2N-T.7')
    expect(ids).not.toContain('CZNIS2N-T.8')
    expect(ids).not.toContain('CZNIS2N-T.12')
    // But other technical opatření do appear (e.g. §21 logging = T.6, §24 appsec = T.9)
    expect(ids).toContain('CZNIS2N-T.6')
    expect(ids).toContain('CZNIS2N-T.9')
  })

  test('Czech NIS2 — both frameworks present in /soa/frameworks list', async () => {
    const res = await authedGet(app, readerCookie, '/soa/frameworks')
    expect(res.status).toBe(200)
    const ids = res.body.map(fw => fw.id)
    expect(ids).toContain('CZNIS2V')
    expect(ids).toContain('CZNIS2N')
  })

  test('Czech NIS2 — controls carry proper theme labels', async () => {
    const res = await authedGet(app, readerCookie, '/soa?framework=CZNIS2V')
    expect(res.status).toBe(200)
    const themes = new Set(res.body.map(c => c.theme))
    expect(themes.has('Organizační opatření')).toBe(true)
    expect(themes.has('Technická opatření')).toBe(true)
    expect(themes.size).toBe(2)
  })
})

describe('SoA – Bearbeiten', () => {
  test('PUT /soa/:id – editor aktualisiert Control', async () => {
    const res = await authedPut(app, editorCookie, `/soa/${CTRL_1}`, {
      status:        'planned',
      applicability: 'Gilt für alle Standorte',
      owner:         'CISO',
      justification: 'In Umsetzung Q3 2026',
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('planned')
    expect(res.body.owner).toBe('CISO')
  })

  test('reader darf NICHT aktualisieren (403)', async () => {
    const res = await authedPut(app, readerCookie, `/soa/${CTRL_2}`, { status: 'planned' })
    expect(res.status).toBe(403)
  })
})

describe('SoA – Cross-Mapping', () => {
  test('GET /soa/crossmap – gibt Mapping-Gruppen', async () => {
    const res = await authedGet(app, readerCookie, '/soa/crossmap')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})
