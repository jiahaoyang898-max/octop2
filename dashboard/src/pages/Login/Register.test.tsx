import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const statusMock = vi.fn().mockResolvedValue({ setup_required: false });
const redeemMock = vi.fn();

vi.mock("../../api/modules/auth", () => ({
  authApi: {
    getAuthStatus: () => statusMock(),
    getOauthStatus: () => Promise.resolve({ providers: [] }),
  },
}));

vi.mock("../../api/modules/invites", () => ({
  invitesApi: {
    redeem: (...args: unknown[]) => redeemMock(...args),
  },
}));

vi.mock("../../utils/locale", () => ({
  applyGuestLocale: () => Promise.resolve(),
  applyUserLocale: () => Promise.resolve(),
}));

import RegisterPage from "./Register";

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /register\.submit|创建账户/ });
}

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  opts: { password: string; confirm: string },
) {
  await user.type(
    screen.getByPlaceholderText(/register\.invitePlaceholder|请输入管理员提供的邀请码/),
    "ABC123",
  );
  await user.type(
    screen.getByPlaceholderText(
      /register\.usernamePlaceholder|用于登录与外观展示/,
    ),
    "newuser",
  );
  await user.type(
    screen.getByPlaceholderText(/register\.passwordPlaceholder|至少 8 位/),
    opts.password,
  );
  await user.type(
    screen.getByPlaceholderText(/register\.confirmPlaceholder|再次输入密码/),
    opts.confirm,
  );
}

describe("Register page", () => {
  it("renders the invite-code form once setup is done", async () => {
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByPlaceholderText(
        /register\.invitePlaceholder|请输入管理员提供的邀请码/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(
        /register\.usernamePlaceholder|用于登录与外观展示/,
      ),
    ).toBeInTheDocument();
    // 未初始化时走 /setup 引导，不展示表单
    expect(screen.queryByText(/register\.setupTitle|实例尚未初始化/)).toBeNull();
  });

  it("blocks submit when the two passwords differ", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText(/register\.invitePlaceholder/);

    await fillForm(user, { password: "Passw0rd!", confirm: "Passw0rd?" });
    expect(screen.getByText("register.matchBad")).toBeInTheDocument();

    await waitFor(() => expect(submitButton()).not.toBeDisabled());
    await user.click(submitButton());
    expect(redeemMock).not.toHaveBeenCalled();
  });

  it("redeems the invite after the terms are accepted", async () => {
    const user = userEvent.setup();
    redeemMock.mockResolvedValue({
      access_token: "tok",
      user: { locale: "zh" },
    });
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText(/register\.invitePlaceholder/);

    await fillForm(user, { password: "Passw0rd!", confirm: "Passw0rd!" });
    expect(screen.getByText("register.matchOk")).toBeInTheDocument();
    expect(screen.getByText("register.strength2")).toBeInTheDocument();

    await waitFor(() => expect(submitButton()).not.toBeDisabled());

    // 未勾选条款 → 拦截
    await user.click(submitButton());
    expect(redeemMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox"));
    await user.click(submitButton());

    await waitFor(() => expect(redeemMock).toHaveBeenCalledTimes(1));
    expect(redeemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "ABC123",
        username: "newuser",
        password: "Passw0rd!",
        email: null,
      }),
    );
  });

  it("submits when Enter is pressed inside the form (B-01)", async () => {
    const user = userEvent.setup();
    redeemMock.mockClear();
    redeemMock.mockResolvedValue({
      access_token: "tok",
      user: { locale: "zh" },
    });
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText(/register\.invitePlaceholder/);

    await fillForm(user, { password: "Passw0rd!", confirm: "Passw0rd!" });
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(submitButton()).not.toBeDisabled());

    // 回车必须能提交：在邀请码输入框内按 Enter
    await user.type(
      screen.getByPlaceholderText(/register\.invitePlaceholder/),
      "{Enter}",
    );

    await waitFor(() => expect(redeemMock).toHaveBeenCalledTimes(1));
    expect(redeemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "ABC123",
        username: "newuser",
        password: "Passw0rd!",
      }),
    );
  });

  it("rejects a malformed email before hitting the API (B-02)", async () => {
    const user = userEvent.setup();
    redeemMock.mockClear();
    redeemMock.mockResolvedValue({
      access_token: "tok",
      user: { locale: "zh" },
    });
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );
    await screen.findByPlaceholderText(/register\.invitePlaceholder/);

    await fillForm(user, { password: "Passw0rd!", confirm: "Passw0rd!" });
    const emailInput = screen.getByPlaceholderText(
      /register\.emailPlaceholder/,
    );
    await user.type(emailInput, "not-an-email");
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(submitButton()).not.toBeDisabled());
    await user.click(submitButton());

    // 邮箱非法 → 前端拦截，请求根本不发出
    expect(redeemMock).not.toHaveBeenCalled();

    // 改成合法邮箱后同一份表单即可提交（证明拦截来自邮箱校验本身）
    await user.clear(emailInput);
    await user.type(emailInput, "me@example.com");
    await user.click(submitButton());

    await waitFor(() => expect(redeemMock).toHaveBeenCalledTimes(1));
    expect(redeemMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "me@example.com" }),
    );
  });

  it("shows the setup notice when the instance is not initialized", async () => {
    statusMock.mockResolvedValueOnce({ setup_required: true });
    render(
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/register\.setupTitle|实例尚未初始化/),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/register\.invitePlaceholder/),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /register\.setupCta|去初始化/ }),
    ).toHaveAttribute("href", "/setup");
  });
});
