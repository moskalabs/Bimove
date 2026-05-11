export function LayersPanel() {
  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">도면층</div>
      <div className="lbar-panel-body">
        {['CO-1', 'CO-2', 'A-WALL', 'A-DOOR', 'A-WINDOW'].map(layer => (
          <div key={layer} className="layer-row">
            <span className="layer-dot" />
            <span>{layer}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
