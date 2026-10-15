import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * K-01 的教训固化：演示条可以默认展示，但组件挂载时**绝不能**拿演示凭据去发一次
 * 真实的 `POST /auth/login`。失败的登录会累加后端锁定计数（本机阈值 5 次 / 900 秒）
 * 并写 `auth.failed` 安全审计记录（`src/octop/infra/users/manager.py`），刷新 5 次
 * 就能把演示账号锁死 15 分钟。
 *
 * spy 放在传输层 `request` 上，所以不管是页面组件还是 `api/modules/auth` 里的任何
 * 辅助函数想探测登录接口，都会被抓到的。
 */
const { requestSpy } = vi.hoisted(() => ({ requestSpy: vi.fn() }));

vi.mock("../../api/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/request")>();
  return { ...actual, request: requestSpy };
});

vi.mock("../../utils/locale", () => ({
  applyGuestLocale: () => Promise.resolve(),
  applyUserLocale: () => Promise.resolve(),
}));

vi.mock("./CaptchaField", () => ({
  default: () => null,
}));

import LoginPage from "./index";
import { authApi } from "../../api/modules/auth";

/** 登录页挂载只需要这几个公开接口；其它路径直接 reject，避免掩盖多余请求。 */
function stubPublicApi(): void {
  requestSpy.mockReset();
  requestSpy.mockImplementation((path: string) => {
    if (path === "/setup/status") {
      return Promise.resolve({ setup_required: false });
    }
    if (path === "/auth/oauth/status") {
      return Promise.resolve({ providers: [] });
    }
    if (path === "/auth/ldap/status") {
      return Promise.resolve({ enabled: false, display_name: "" });
    }
    if (path === "/auth/captcha") {
      return Promise.resolve({ provider: "none" });
    }
    return Promise.reject(new Error(`unexpected api call in test: ${path}`));
  });
}

/** 挂载/交互期间真实发出去的登录 POST（就是本次要禁止的那种请求）。 */
function loginPosts(): unknown[][] {
  return requestSpy.mock.calls.filter(
    ([path, init]) =>
      path === "/auth/login" &&
      (init as { method?: string } | undefined)?.method === "POST",
  );
}

describe("Login demo account bar", () => {
  beforeEach(() => {
    stubPublicApi();
  });

  it("renders the demo bar without probing /auth/login on mount (K-01)", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    // 演示条是无条件渲染的：不依赖任何「先试一次登录」的探测结果。
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    expect(screen.getByText("Demo@2026")).toBeInTheDocument();
    await waitFor(() =>
      expect(requestSpy).toHaveBeenCalledWith("/setup/status"),
    );

    // 核心回归防护：挂载过程中一次真实登录 POST 都不许有。
    expect(loginPosts()).toHaveLength(0);

    // 正控制：证明上面的 spy 确实能抓到登录 POST，断言不是空转。
    await authApi
      .login("some-user", "some-password")
      .catch(() => undefined);
    expect(loginPosts()).toHaveLength(1);
  });

  it("shows the demo credentials and fills them on click", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    // 演示账号条：账号 / 密码明文展示
    expect(screen.getByText("Demo@2026")).toBeInTheDocument();

    const fillButton = screen.getByRole("button", {
      name: /login\.demoFill|一键填入/,
    });
    await user.click(fillButton);

    const username = screen.getByPlaceholderText(
      /login\.username|用户名或邮箱/,
    );
    const password = screen.getByPlaceholderText(/login\.password|密码/);
    expect(username).toHaveValue("demo");
    expect(password).toHaveValue("Demo@2026");
    // 按钮短暂回跳为「已填入」
    expect(fillButton).toHaveTextContent(/login\.demoFilled|已填入/);
    // 填入只是写表单，同样不该产生登录请求
    expect(loginPosts()).toHaveLength(0);
  });

  it("links to the register page", () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", {
      name: /login\.registerCta|创建账户/,
    });
    expect(link).toHaveAttribute("href", "/register");
  });
});
