def pytest_addoption(parser):
    parser.addoption(
        "--compare-modal",
        action="store_true",
        default=False,
        help="고정 파일로 로컬과 Modal 테스트 전용 함수의 단계별 처리 시간을 비교합니다.",
    )
