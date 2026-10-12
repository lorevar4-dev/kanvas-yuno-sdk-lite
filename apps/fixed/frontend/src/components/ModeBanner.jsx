export default function ModeBanner({ mode, demoDoubleClick }) {
  return (
    <>
      {mode === 'mock' ? (
        <div className="banner mock">MOCK MODE · local Yuno simulator — no real Yuno API calls</div>
      ) : (
        <div className="banner sandbox">Yuno SANDBOX · api-sandbox.y.uno</div>
      )}
      {demoDoubleClick && (
        <div className="banner demo">DEMO · double-click simulation: UI guard off, every Pay fires twice — the server must still charge once</div>
      )}
    </>
  )
}
