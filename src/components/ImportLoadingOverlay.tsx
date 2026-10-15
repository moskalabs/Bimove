/** 임포트 진행 중 화면을 덮는 스피너 카드. */
export function ImportLoadingOverlay({ message }: { message: string }) {
  return (
    <div className="import-loading-overlay">
      <div className="import-loading-card">
        <div className="import-loading-spinner" />
        <div className="import-loading-msg">{message}</div>
      </div>
    </div>
  )
}
