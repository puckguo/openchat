from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(ignore_https_errors=True)
    page = context.new_page()

    try:
        page.goto('https://localhost:8888', timeout=30000)
        page.wait_for_load_state('networkidle', timeout=30000)
        page.screenshot(path='test_result.png', full_page=True)
        print("Screenshot saved to test_result.png")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        browser.close()
