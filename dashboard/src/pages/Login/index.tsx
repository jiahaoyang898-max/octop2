import { useState, useEffect, useRef, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Input, Button, Checkbox } from "antd";
import { message } from "@/utils/antdMessage";

import {
  KeyRound,
  Lock,
  User,
  Users,
  BookOpen,
  BarChart3,
  Plug,
  ArrowRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  clearAuthToken,
  setAuthToken,
  setRememberLoginPreference,
} from "../../api";
import {
  authApi,
  type LdapStatus,
  type OauthProviderStatus,
} from "../../api/modules/auth";
import { apiErrorMessage } from "../../utils/apiError";
import { refreshServerLabels } from "../../i18n";
import { applyUserLocale, applyGuestLocale } from "../../utils/locale";
import {
  isSsoPopup,
  isSsoPopupMessage,
  notifySsoOpener,
  openSsoPopup,
} from "../../utils/ssoPopup";
import styles from "./index.module.less";
import feishuIcon from "../../assets/channels/feishu.svg";
import dingtalkIcon from "../../assets/channels/dingtalk.svg";
import wecomIcon from "../../assets/channels/wecom.svg";
import googleIcon from "../../assets/providers/google.svg";
import CaptchaField, { type CaptchaFieldHandle } from "./CaptchaField";
import ForgotPasswordModal from "./ForgotPasswordModal";
import { type PublicCaptchaConfig } from "./captchaAdapters";

/**
 * 演示账号的展示用凭据（仅用于一键填入，不绕过任何后端校验）。
 * 账号由部署脚本创建：`docker/octop-up.sh` / `octop-up.cmd`。
 *
 * 演示条**不做**任何「用真实凭据预登录」的存在性探测：失败的 `POST /auth/login`
 * 会累加后端锁定计数并写 `auth.failed` 审计（`src/octop/infra/users/manager.py`），
 * 刷新几次就能把演示账号锁死并污染安全审计页。账号是否可用改由文案提示 +
 * 真实登录失败时的后端错误信息告诉用户。
 */
const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "Demo@2026";

/** 墨枢标识（设计稿立方徽标）。 */
function BrandMark({ size = 19 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7.5 4.3v8.6L12 20.2 4.5 15.9V7.3z" />
      <path d="M12 3v17.2" />
      <path d="M4.5 7.3 12 11.6l7.5-4.3" />
    </svg>
  );
}

/** 抽象山形等高线（意象装饰，非实拍）。 */
function Contour() {
  return (
    <svg
      className={styles.contour}
      viewBox="0 0 1440 720"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <path
        className={`${styles.cLine} ${styles.cL3}`}
        d="M-20,470 L120,392 L210,430 L330,318 L430,392 L560,300 L690,398 L820,330 L960,428 L1090,352 L1230,440 L1340,392 L1460,452"
      />
      <path
        className={`${styles.cLine} ${styles.cL2}`}
        d="M-20,560 L110,470 L250,534 L390,412 L520,510 L660,398 L800,516 L930,432 L1070,540 L1210,452 L1350,548 L1460,506"
      />
      <path
        className={`${styles.cLine} ${styles.cL1}`}
        d="M-20,648 L140,566 L300,640 L470,522 L640,632 L810,540 L980,648 L1150,556 L1320,652 L1460,596"
      />
      <path
        className={`${styles.cLine} ${styles.cL4} ${styles.cSc}`}
        d="M-20,700 L200,640 L380,690 L560,626 L740,690 L920,628 L1100,692 L1280,634 L1460,694"
      />
      <path
        className={`${styles.cLine} ${styles.cL4} ${styles.cSc}`}
        style={{ animationDelay: "-8s" }}
        d="M-20,732 L240,690 L460,736 L680,682 L900,738 L1120,684 L1340,740 L1460,712"
      />
      <ellipse className={`${styles.cLine} ${styles.cL3}`} cx="470" cy="560" rx="150" ry="42" />
      <ellipse className={`${styles.cLine} ${styles.cL3}`} cx="470" cy="560" rx="104" ry="29" />
      <ellipse className={`${styles.cLine} ${styles.cL3}`} cx="980" cy="600" rx="126" ry="36" />
    </svg>
  );
}

function providerLabel(
  provider: OauthProviderStatus,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const name = provider.display_name.trim();
  if (name) return name;
  return t(`login.providerKind.${provider.kind}`, {
    defaultValue: provider.kind,
  });
}

function providerIcon(provider: OauthProviderStatus): ReactNode {
  if (provider.kind === "feishu") {
    return (
      <img src={feishuIcon} alt="" width={18} height={18} draggable={false} />
    );
  }
  if (provider.kind === "dingtalk") {
    return (
      <img src={dingtalkIcon} alt="" width={18} height={18} draggable={false} />
    );
  }
  if (provider.kind === "wecom") {
    return (
      <img src={wecomIcon} alt="" width={18} height={18} draggable={false} />
    );
  }
  const name = provider.display_name.trim().toLowerCase();
  if (
    provider.kind === "oidc" &&
    (name === "google" || name.includes("google"))
  ) {
    return (
      <img src={googleIcon} alt="" width={18} height={18} draggable={false} />
    );
  }
  return <KeyRound size={18} />;
}

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<OauthProviderStatus[]>([]);
  const [ldap, setLdap] = useState<LdapStatus | null>(null);
  const [ssoLoadingKind, setSsoLoadingKind] = useState<string | null>(null);
  const [captchaReady, setCaptchaReady] = useState(false);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [showForgotHelp, setShowForgotHelp] = useState(false);
  const [captcha, setCaptcha] = useState<PublicCaptchaConfig>({
    provider: "slider",
  });
  const [demoFilled, setDemoFilled] = useState(false);
  const captchaRef = useRef<CaptchaFieldHandle>(null);
  const demoFillTimer = useRef<number | null>(null);

  useEffect(() => {
    void applyGuestLocale();
  }, []);

  useEffect(() => {
    let cancelled = false;
    authApi
      .getAuthStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.setup_required) {
          clearAuthToken();
          navigate("/setup", { replace: true });
          return;
        }
        // Only probe OIDC / captcha after setup is done — otherwise lockdown 503s.
        authApi
          .getOauthStatus()
          .then((next) => {
            if (!cancelled) {
              setProviders(next.providers.filter((item) => item.enabled));
            }
          })
          .catch(() => {});
        authApi
          .getLdapStatus()
          .then((next) => {
            if (!cancelled) setLdap(next);
          })
          .catch(() => {});
        authApi
          .getCaptcha()
          .then((next) => {
            if (!cancelled) setCaptcha(next);
          })
          .catch(() => {
            if (!cancelled) setCaptcha({ provider: "slider" });
          });
      })
      .catch(() => {
        // Backend unreachable — let the user attempt login and show a real
        // error from the request itself; redirecting blindly to /setup
        // would mask the actual problem.
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    const code = searchParams.get("oidc_error");
    if (!code) return;
    if (notifySsoOpener({ ok: false, error: code })) return;
    message.error(
      t(`login.oidcError.${code}`, {
        defaultValue: t("login.oidcError.generic"),
      }),
    );
    navigate("/login", { replace: true });
  }, [navigate, searchParams, t]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isSsoPopupMessage(event, window.location.origin) || !event.data.ok) {
        if (
          isSsoPopupMessage(event, window.location.origin) &&
          !event.data.ok
        ) {
          setSsoLoadingKind(null);
          const code = event.data.error || "generic";
          message.error(
            t(`login.oidcError.${code}`, {
              defaultValue: t("login.oidcError.generic"),
            }),
          );
        }
        return;
      }
      if (event.data.access_token) {
        setAuthToken(event.data.access_token, event.data.remember ?? true);
      }
      window.location.replace(event.data.redirect || "/chat");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [t]);

  // 演示账号「一键填入」的按钮回跳定时器，卸载时清理。
  useEffect(
    () => () => {
      if (demoFillTimer.current !== null) {
        window.clearTimeout(demoFillTimer.current);
      }
    },
    [],
  );

  const resetCaptcha = () => {
    setCaptchaReady(false);
    setCaptchaResetKey((k) => k + 1);
  };

  const onSso = async (kind: string) => {
    setSsoLoadingKind(kind);
    setRememberLoginPreference(remember);
    let popup: Window | null = null;
    if (kind !== "oidc") {
      popup = openSsoPopup();
    }
    try {
      const { authorization_url } = await authApi.startOauth(kind, "/chat");
      if (kind === "oidc") {
        window.location.href = authorization_url;
        return;
      }
      if (popup && !popup.closed) {
        popup.location.href = authorization_url;
        const timer = window.setInterval(() => {
          if (!popup || popup.closed) {
            window.clearInterval(timer);
            setSsoLoadingKind((current) => (current === kind ? null : current));
          }
        }, 400);
      } else {
        popup?.close();
        message.error(t("account.ssoPopupBlocked"));
        setSsoLoadingKind(null);
      }
    } catch (err) {
      popup?.close();
      message.error(apiErrorMessage(err, t("login.oidcStartFailed"), t));
      setSsoLoadingKind(null);
    }
  };

  const handleLogin = async () => {
    if (!username || !password || !captchaReady) return;
    setLoading(true);
    try {
      const token = await captchaRef.current?.getToken();
      const res = await authApi.login(username, password, token);
      setAuthToken(res.access_token, remember);
      await applyUserLocale(res.user.locale);
      void refreshServerLabels(res.user.locale);
      navigate("/chat", { replace: true });
    } catch (err) {
      message.error(apiErrorMessage(err, t("login.failed"), t));
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const fillDemoAccount = () => {
    setUsername(DEMO_USERNAME);
    setPassword(DEMO_PASSWORD);
    setDemoFilled(true);
    if (demoFillTimer.current !== null) {
      window.clearTimeout(demoFillTimer.current);
    }
    demoFillTimer.current = window.setTimeout(() => {
      setDemoFilled(false);
      demoFillTimer.current = null;
    }, 1800);
  };

  if (isSsoPopup() && searchParams.get("oidc_error")) {
    return null;
  }

  return (
    <div className={styles.shell}>
      {/* ─── 背景层：环境辉光 / 细网格 / 呼吸光晕 / 山形等高线 / 晕影 ─── */}
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.grid} aria-hidden="true" />
      <div className={styles.auroraBlue} aria-hidden="true" />
      <div className={styles.auroraCyan} aria-hidden="true" />
      <Contour />
      <div className={styles.vignette} aria-hidden="true" />

      {/* ─── 顶部品牌栏 ─── */}
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.logoMark}>
            <BrandMark />
          </div>
          <div className={styles.brandText}>
            <div className={styles.brandName}>{t("login.brandName")}</div>
            <div className={styles.brandSub}>{t("login.brandTagline")}</div>
          </div>
        </div>
        <div className={styles.sys}>
          <span className={styles.sysDot} />
          <span>{t("login.sysHint")}</span>
          <span className={styles.mono}>~/.octop</span>
        </div>
      </header>

      {/* ─── 玻璃卡片 ─── */}
      <main className={styles.stage}>
        <div className={styles.float}>
          <div className={styles.brandBlock} aria-hidden="true">
            <BrandMark size={26} />
          </div>

          <div className={styles.card}>
            <span className={`${styles.tick} ${styles.tickTl}`} />
            <span className={`${styles.tick} ${styles.tickTr}`} />
            <span className={`${styles.tick} ${styles.tickBl}`} />
            <span className={`${styles.tick} ${styles.tickBr}`} />

            {/* ══ 左栏：表单 ══ */}
            <section className={styles.colForm}>
              <div className={styles.eyebrow}>
                <span className={styles.eyebrowLn} />
                {t("login.eyebrow")}
              </div>
              <h1 className={styles.h1}>
                {t("login.headline")}
                <span className={styles.gradText}>{t("login.headlineGrad")}</span>
              </h1>
              <p className={styles.lead}>{t("login.lead")}</p>

              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleLogin();
                }}
              >
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="login-username">
                    {t("login.usernameLabel")}
                  </label>
                  <Input
                    id="login-username"
                    prefix={<User size={16} />}
                    placeholder={t("login.username")}
                    size="large"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                    aria-describedby="login-username-hint"
                  />
                  <div id="login-username-hint" className={styles.fieldHint}>
                    {t("login.usernameHint")}
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="login-password">
                    {t("login.passwordLabel")}
                  </label>
                  <Input.Password
                    id="login-password"
                    prefix={<Lock size={16} />}
                    placeholder={t("login.password")}
                    size="large"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onPressEnter={handleLogin}
                  />
                </div>

                {ldap?.enabled && (
                  <p className={styles.ldapHint}>
                    {t("login.ldapHint", {
                      name: ldap.display_name.trim() || t("adminSso.ldap.kind"),
                    })}
                  </p>
                )}

                <div className={styles.captchaSlot}>
                  <CaptchaField
                    ref={captchaRef}
                    config={captcha}
                    resetKey={captchaResetKey}
                    slideHint={t("login.slideHint")}
                    slideVerifiedLabel={t("login.slideVerified")}
                    unsupportedLabel={t("login.unsupportedCaptcha")}
                    onReadyChange={setCaptchaReady}
                  />
                </div>

                <div className={styles.rowMeta}>
                  <Checkbox
                    className={styles.remember}
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  >
                    {t("login.remember")}
                  </Checkbox>
                  <button
                    type="button"
                    data-testid="login-forgot-password-toggle"
                    className={styles.forgot}
                    onClick={() => setShowForgotHelp(true)}
                  >
                    {t("login.forgotPassword", "Forgot password?")}
                  </button>
                </div>
              </form>

              <ForgotPasswordModal
                open={showForgotHelp}
                onClose={() => setShowForgotHelp(false)}
              />

              <p className={styles.miniLegal}>
                {t("login.miniLegalPrefix")}{" "}
                <span className={styles.mono}>~/.octop</span> ·{" "}
                {t("login.miniLegalSuffix")}
              </p>
            </section>

            {/* ══ 右栏：操作区 ══ */}
            <aside className={styles.colAct}>
              <span className={styles.actBadge}>
                <span className={styles.badgeDot} />
                {t("login.actBadge")}
              </span>

              <h2 className={styles.actTitle}>{t("login.actTitle")}</h2>
              <p className={styles.actDesc}>{t("login.actDesc")}</p>

              <Button
                type="primary"
                size="large"
                block
                loading={loading}
                onClick={handleLogin}
                disabled={!username || !password || !captchaReady}
                className={styles.btnPrimary}
              >
                {t("login.submit")}
                <ArrowRight size={16} />
              </Button>

              {/* ══ 演示账号（一键填入，凭据仅作展示；账号由部署脚本创建，不做预登录探测）══ */}
              <div className={styles.demoHint} role="note">
                <div className={styles.demoRow}>
                  <span className={styles.demoKey}>{t("login.demoAccount")}</span>
                  <span className={styles.demoVal}>{DEMO_USERNAME}</span>
                  <span className={styles.demoSep}>/</span>
                  <span className={styles.demoKey}>{t("login.demoPassword")}</span>
                  <span className={styles.demoVal}>{DEMO_PASSWORD}</span>
                  <button
                    type="button"
                    className={styles.demoBtn}
                    onClick={fillDemoAccount}
                  >
                    {demoFilled ? t("login.demoFilled") : t("login.demoFill")}
                  </button>
                </div>
                <p className={styles.demoNote}>{t("login.demoNote")}</p>
              </div>

              <p className={styles.swap}>
                {t("login.noAccount")}
                <Link to="/register" className={styles.swapLink}>
                  {t("login.registerCta")}
                </Link>
              </p>

              {providers.length > 0 && (
                <>
                  <div className={styles.divider}>{t("login.or")}</div>
                  <div className={styles.sso}>
                    {providers.map((provider) => (
                      <Button
                        key={provider.kind}
                        size="large"
                        block
                        icon={providerIcon(provider)}
                        loading={ssoLoadingKind === provider.kind}
                        onClick={() => void onSso(provider.kind)}
                        className={styles.ssoBtn}
                      >
                        {t("login.oidcWith", { name: providerLabel(provider, t) })}
                      </Button>
                    ))}
                  </div>
                </>
              )}

              <div className={styles.actFoot}>
                <span className={styles.footDot} />
                <span>
                  {t("login.serviceRunning")} ·{" "}
                  <span className={styles.mono}>127.0.0.1:8088</span>
                </span>
              </div>
            </aside>
          </div>

          {/* ─── 能力卡 ─── */}
          <div className={styles.capGrid}>
            <div className={styles.capCard}>
              <Users size={15} className={styles.capIconCyan} />
              <div>
                <div className={styles.capTitle}>
                  {t("login.capability.agents.title")}
                </div>
                <div className={styles.capDesc}>
                  {t("login.capability.agents.desc")}
                </div>
              </div>
            </div>
            <div className={styles.capCard}>
              <BookOpen size={15} className={styles.capIconBlue} />
              <div>
                <div className={styles.capTitle}>
                  {t("login.capability.rag.title")}
                </div>
                <div className={styles.capDesc}>
                  {t("login.capability.rag.desc")}
                </div>
              </div>
            </div>
            <div className={styles.capCard}>
              <BarChart3 size={15} className={styles.capIconAmber} />
              <div>
                <div className={styles.capTitle}>
                  {t("login.capability.token.title")}
                </div>
                <div className={styles.capDesc}>
                  {t("login.capability.token.desc")}
                </div>
              </div>
            </div>
            <div className={styles.capCard}>
              <Plug size={15} className={styles.capIconGrass} />
              <div>
                <div className={styles.capTitle}>
                  {t("login.capability.connector.title")}
                </div>
                <div className={styles.capDesc}>
                  {t("login.capability.connector.desc")}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ─── 页面底部归属声明 ─── */}
      <footer className={styles.attribution}>
        <div className={styles.seal}>
          <span className={styles.sealLn} />
          {t("login.seal")}
          <span className={styles.sealLn} />
        </div>
        <div>
          {t(
            "login.attribution",
            "本产品基于开源项目 Octop（Copyright (c) 2026 Octop，MIT License）二次开发，与腾讯公司无关联。",
          )}
        </div>
      </footer>
    </div>
  );
}
