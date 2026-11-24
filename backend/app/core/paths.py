import ntpath
import posixpath
import re
import unicodedata


MAX_PATH_LENGTH = 4096
MAX_RELATIVE_PATH_LENGTH = 1024
WINDOWS_DRIVE_PATH = re.compile(r"^[A-Za-z]:[\\/]")
WINDOWS_FORBIDDEN = frozenset('<>:"|?*')
WINDOWS_RESERVED = frozenset({
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
})
UNSAFE_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Co"})


def has_unsafe_characters(value: str) -> bool:
    return any(unicodedata.category(char) in UNSAFE_CATEGORIES for char in value)


def clean_display_name(value: str, max_length: int) -> str:
    name = value.strip()
    if not name or len(name) > max_length or has_unsafe_characters(name):
        raise ValueError(f"이름은 제어 문자 없이 1자 이상 {max_length}자 이하로 입력하세요.")
    return name


def is_windows_path(value: str) -> bool:
    return bool(WINDOWS_DRIVE_PATH.match(value)) or value.startswith("\\\\")


def validate_local_path(value: str) -> str:
    if not value or value != value.strip() or len(value) > MAX_PATH_LENGTH or has_unsafe_characters(value):
        raise ValueError("로컬 경로 형식이 올바르지 않습니다.")
    windows = is_windows_path(value)
    if not windows and not value.startswith("/"):
        raise ValueError("로컬 경로는 절대 경로여야 합니다.")
    if any(part in {".", ".."} for part in re.split(r"[\\/]+", value)):
        raise ValueError("로컬 경로에는 `.`, `..`를 사용할 수 없습니다.")
    body = value[2:] if WINDOWS_DRIVE_PATH.match(value) else value
    if windows and WINDOWS_FORBIDDEN.intersection(body):
        raise ValueError("로컬 경로에 사용할 수 없는 문자가 있습니다.")
    return value


def normalize_local_path(value: str) -> str:
    """중복 등록 비교에만 쓰는 키를 만든다. Windows 경로는 대소문자를 구분하지 않는다."""
    path = unicodedata.normalize("NFC", value)
    if is_windows_path(path):
        return ntpath.normpath(path).casefold()
    return posixpath.normpath(path)


def validate_relative_path(value: str, label: str = "제외 경로") -> str:
    # 제외 판단은 문자열 비교라서 Windows(NFC)·macOS(NFD) 한글이 같게 비교되도록 NFC로 맞춘다.
    path = unicodedata.normalize("NFC", value).replace("\\", "/")
    if not path.strip():
        raise ValueError(f"{label}는 비어 있을 수 없습니다.")
    if len(path) > MAX_RELATIVE_PATH_LENGTH:
        raise ValueError(f"{label}는 {MAX_RELATIVE_PATH_LENGTH}자 이하여야 합니다.")
    if path.startswith("/") or re.match(r"^[A-Za-z]:", path):
        raise ValueError(f"{label}는 폴더 루트 기준 상대 경로여야 합니다.")
    if has_unsafe_characters(path) or WINDOWS_FORBIDDEN.intersection(path):
        raise ValueError(f"{label}에 사용할 수 없는 문자가 있습니다.")
    for segment in path.split("/"):
        if not segment:
            raise ValueError(f"{label}에 빈 이름이 있습니다.")
        if segment in {".", ".."}:
            raise ValueError(f"{label}에는 `.`, `..`를 사용할 수 없습니다.")
        if segment != segment.strip() or segment.endswith("."):
            raise ValueError("파일·폴더 이름은 공백이나 점으로 끝날 수 없습니다.")
        if segment.split(".")[0].upper() in WINDOWS_RESERVED:
            raise ValueError("Windows 예약 이름은 사용할 수 없습니다.")
    return path


def validate_document_path(value: str) -> str:
    return validate_relative_path(value, "문서 경로")


def is_excluded(relative_path: str, excluded_paths: list[str]) -> bool:
    """설계 규칙: 경로가 제외 경로와 같거나 "제외 경로/"로 시작하면 제외한다."""
    path = unicodedata.normalize("NFC", relative_path)
    for excluded in excluded_paths:
        rule = unicodedata.normalize("NFC", excluded)
        if path == rule or path.startswith(rule + "/"):
            return True
    return False


def join_local_path(root: str, relative_path: str) -> str:
    """폴더 루트 경로와 문서 상대 경로로 해당 기기의 예상 파일 경로를 만든다."""
    if is_windows_path(root):
        return ntpath.join(root, relative_path.replace("/", "\\"))
    return posixpath.join(root, relative_path)
