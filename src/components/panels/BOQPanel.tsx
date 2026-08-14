import { FinishingTab } from './boq/FinishingTab'

export function BOQPanel() {
  return (
    <div className="lbar-panel">
      <div className="lbar-panel-header">Tables</div>
      <div className="lbar-panel-body" style={{ fontSize: 13 }}>
        <FinishingTab />
      </div>
    </div>
  )
}
