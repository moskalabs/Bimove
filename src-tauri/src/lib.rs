use std::path::Path;

// ⚠ 알려진 한계 — 데스크톱 빌드를 쓰기 시작하기 전에 반드시 고칠 것.
//
// 아래 두 커맨드는 **임의 경로**를 받는다. 프런트엔드는 항상 다이얼로그로
// 고른 경로만 넘기지만(project.ts 의 saveProject/openProject), 다이얼로그는
// JS 쪽 plugin-dialog 에서 열리므로 여기서는 그걸 알 수가 없다. 즉 렌더러에
// 스크립트가 주입되면 (예: 내보내기 HTML XSS) invoke('read_text_file') 로
// 사용자 PC 의 아무 파일이나 읽고 쓸 수 있다. capabilities 의 dialog 권한은
// 직접 만든 커맨드를 막지 못한다.
//
// 고칠 방향: 다이얼로그를 Rust 로 옮겨 임의 경로가 IPC 경계를 넘지 않게 한다.
//   open_project_file() -> Option<(path, content)>
//   save_project_file(default_name, content) -> Option<path>
// 그러면 read_text_file / write_text_file 은 지우면 된다.
//
// 지금 당장의 완화책은 tauri.conf.json 의 CSP 와, 내보내기 템플릿의
// HTML 이스케이프(poExport/quoteExport/reportExport) 다.

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
