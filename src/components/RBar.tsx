export function RBar() {
  return (
    <aside className="rbar">
      <section className="rbar-section">
        <h3>프로젝트</h3>
        <div className="rbar-row">
          <span>파일명</span>
          <span>Drawing 1</span>
        </div>
        <div className="rbar-row">
          <span>프로필</span>
          <span>BuildAI</span>
        </div>
        <div className="rbar-row">
          <span>스타일</span>
          <div className="rbar-toggle">
            <button className="active">Light</button>
            <button>Dark</button>
          </div>
        </div>
      </section>
      <section className="rbar-section">
        <h3>모델 페이지</h3>
        <div className="rbar-row">
          <span>배치</span>
          <span>평면 (Floor Plan)</span>
        </div>
        <div className="rbar-row">
          <span>도면층</span>
          <span className="rbar-badge">CO-1</span>
        </div>
        <div className="rbar-row">
          <span>단위</span>
          <span>Millimeters</span>
        </div>
        <div className="rbar-row">
          <span>스케일</span>
          <span>1:1</span>
        </div>
      </section>
    </aside>
  )
}
