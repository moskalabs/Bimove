// 데스크톱(Tauri) 쪽 커맨드.
//
// ── 왜 다이얼로그가 여기 있나 ──
//
// 전엔 `read_text_file(path)` / `write_text_file(path, content)` 두 개를 열어
// 두고, 경로는 JS 쪽 plugin-dialog 이 골라 넘겼다. 그러면 **임의 경로가 IPC
// 경계를 넘는다** — 렌더러에 스크립트가 주입되면(예: 내보내기 HTML XSS)
// `invoke('read_text_file', { path: 'C:/Users/…/id_rsa' })` 한 줄로 사용자 PC
// 의 아무 파일이나 읽고 쓸 수 있었다. capabilities 의 dialog 권한은 우리가
// 직접 만든 커맨드를 막아주지 않는다.
//
// 그래서 다이얼로그를 Rust 로 가져왔다. 이제 **렌더러는 경로를 주지 않는다.**
// 고르는 것도 읽는 것도 여기서 하고, 돌려주는 경로는 화면에 보여주는 용도다.
// 사람이 다이얼로그에서 직접 고른 파일 하나 말고는 아무것도 못 건드린다.
//
// 취소는 에러가 아니다 — `None` 으로 돌려준다. 에러로 만들면 호출부가
// "취소" 와 "읽기 실패" 를 구분하려고 메시지 문자열을 뒤지게 된다.

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

/// 연 파일. `path` 는 **보여주기용**이다 — 다시 넘겨받지 않는다.
#[derive(Serialize)]
pub struct OpenedFile {
    path: String,
    content: String,
}

/// 도면 파일을 고르고 **그 자리에서 읽는다.** 취소하면 `None`.
///
/// `async fn` 이어야 한다. `blocking_*` 다이얼로그는 메인 스레드에서 부르면
/// 안 되는데, Tauri 는 async 커맨드를 워커에서 돌린다.
#[tauri::command]
async fn open_project_file(app: tauri::AppHandle) -> Result<Option<OpenedFile>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("bimova 도면", &["bimova", "json"])
        .blocking_pick_file();

    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(OpenedFile { path: path.display().to_string(), content }))
}

/// 저장할 자리를 고르고 **그 자리에 쓴다.** 취소하면 `None`.
#[tauri::command]
async fn save_project_file(
    app: tauri::AppHandle,
    default_name: String,
    content: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("bimova 도면", &["bimova", "json"])
        .set_file_name(default_name)
        .blocking_save_file();

    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    // 다이얼로그가 고른 자리라 부모는 이미 있다. 그래도 만들어 두는 건
    // "저장" 을 누르고 아무 일도 안 일어나는 것보다 낫다.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_project_file,
            save_project_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
