from camoufox.sync_api import Camoufox
import time

dirname = input("请输入保存 Cookie 的文件名 (不带后缀): ")
if not dirname:
    dirname = "xhs_cookie"

proxy={
    "server": "socks5h://host.docker.internal:10808",
    "username": "spider",
    "password": "rainbow"
    }

with Camoufox(window=(1282, 855), headless="virtual",persistent_context=True,user_data_dir=f"./{dirname}",proxy=proxy) as context:
    page = context.new_page()
    page.goto("https://www.xiaohongshu.com/explore")
    print("等待页面加载...")
    time.sleep(3)

    # 整个过程我们只认这一个元素
    login_btn = page.locator(".channel-list-content").locator("#login-btn")
    
    # 【核心逻辑：不管弹窗有没有、可见不可见，直接操作按钮】
    if login_btn.is_visible():
        try:
            # 尝试正常点击，如果页面很干净没有幽灵遮罩，这步就成功了
            login_btn.click(timeout=3000)
            print("✅ 成功正常点击登录按钮")
        except Exception as e:
            # 如果报错被遮罩拦截（intercepts pointer events）
            if "intercepts pointer events" in str(e):
                print("👻 遇到幽灵遮罩拦截，启动 force=True 强制点击绕过...")
                # force=True 无视透明遮罩，直接物理穿透点击
                login_btn.click(force=True, timeout=3000)
                print("✅ 已强制点击触发弹窗")
            else:
                print(f"❌ 点击出现其他情况: {e}")
    else:
        print("✅ 登录按钮未出现，可能页面已经处于登录状态，或弹窗已完全铺满屏幕")

    # 强制等待 3 秒，让二维码的 <img> 标签和网络请求飞一会儿
    print("等待二维码加载...")
    time.sleep(3) 

    print("👉 请打开本地查看 login.png 并用手机小红书扫码...")
    page.screenshot(path="login.png")

    # 智能等待扫码结果：只通过“登录按钮是否消失”来判断
    is_logged_in = False
    for i in range(120):  
        if not login_btn.is_visible():
            print("\n🎉 检测到登录按钮消失，扫码登录成功！")
            is_logged_in = True
            break
        
        # 持续截图，如果二维码过期你可以在本地直接看到，不需要管它是 img 还是 canvas
        page.screenshot(path="login.png")
        time.sleep(1)

    if is_logged_in:
        print("💾 状态已成功保存")
    else:
        print("❌ 二维码等待超时。")