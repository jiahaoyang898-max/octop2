import {
  useState,
  useEffect,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { Input, Button } from "antd";
import { message } from "@/utils/antdMessage";

import {
  KeyRound,
  Lock,
  User,
  Mail,
  ShieldCheck,
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { setAuthToken } from "../../api";
import { authApi, type OauthProviderStatus } from "../../api/modules/auth";
import { invitesApi } from "../../api/modules/invites";
import { apiErrorMessage } from "../../utils/apiError";
import {
  MIN_PASSWORD_LENGTH,
  passwordPolicyIssue,
} from "../../utils/passwordPolicy";
import { refreshServerLabels } from "../../i18n";
import { applyGuestLocale, applyUserLocale } from "../../utils/locale";
import {
  isSsoPopupMessage,
  openSsoPopup,
} from "../../utils/ssoPopup";
import styles from "./index.module.less";
import regStyles from "./register.module.less";
import feishuIcon from "../../assets/channels/feishu.svg";
import dingtalkIcon from "../../assets/channels/dingtalk.svg";
import wecomIcon from "../../assets/channels/wecom.svg";
import googleIcon from "../../assets/providers/google.svg";

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

/** 密码强度评分（与设计稿 score() 一致）：0 未输入 / 1 弱 / 2 中 / 3 强。 */
function strengthScore(value: string): number {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[A-Za-z]/.test(value) && /\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value) && value.length >= 10) score += 1;
  return Math.max(1, Math.min(score, 3));
}

/** 注册可用性：setup=实例尚未初始化需先走向导；open=邀请码注册。 */
type RegisterStatus = "probing" | "open" | "setup";

/** 与后端 `src/octop/infra/users/email.py:11` 的 _EMAIL_RE 逐字保持一致。 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<RegisterStatus>("probing");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState<OauthProviderStatus[]>([]);
  const [ssoLoadingKind, setSsoLoadingKind] = useState<string | null>(null);

  useEffect(() => {
    void applyGuestLocale();
  }, []);

  useEffect(() => {
    let cancelled = false;
    authApi
      .getAuthStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next.setup_required ? "setup" : "open");
      })
      .catch(() => {
        if (!cancelled) setStatus("open");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    authApi
      .getOauthStatus()
      .then((next) => {
        if (!cancelled) {
          setProviders(next.providers.filter((item) => item.enabled));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isSsoPopupMessage(event, window.location.origin) || !event.data.ok) {
        if (
          isSsoPopupMessage(event, window.location.origin) &&
          !event.data.ok
        ) {
          setSsoLoadingKind(null);
          const errCode = event.data.error || "generic";
          message.error(
            t(`login.oidcError.${errCode}`, {
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

  const onSso = async (kind: string) => {
    setSsoLoadingKind(kind);
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

  const passwordPolicyMessage = (
    issue: ReturnType<typeof passwordPolicyIssue>,
  ) => {
    switch (issue) {
      case "too_short":
        return t("account.passwordTooShort", { min: MIN_PASSWORD_LENGTH });
      case "need_letter_and_digit":
        return t("account.passwordNeedLetterAndDigit");
      case "too_common":
        return t("account.passwordTooCommon");
      default:
        return t("account.passwordTooWeak");
    }
  };

  const handleRegister = async () => {
    if (status !== "open") return;
    if (!code.trim()) {
      message.error(t("register.inviteRequired"));
      return;
    }
    if (!username.trim()) {
      message.error(t("register.usernameRequired"));
      return;
    }
    if (password !== confirmPassword) {
      message.error(t("register.passwordMismatch"));
      return;
    }
    const issue = passwordPolicyIssue(password);
    if (issue) {
      message.error(passwordPolicyMessage(issue));
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      message.error(t("apiErrors.EMAIL_INVALID"));
      return;
    }
    if (!agreed) {
      message.error(t("register.tosRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await invitesApi.redeem({
        code: code.trim(),
        username: username.trim(),
        password,
        email: email.trim() || null,
      });
      setAuthToken(res.access_token);
      await applyUserLocale(res.user.locale);
      void refreshServerLabels(res.user.locale);
      navigate("/chat", { replace: true });
    } catch (err) {
      message.error(apiErrorMessage(err, t("register.failed"), t));
    } finally {
      setSubmitting(false);
    }
  };

  const score = strengthScore(password);
  const setupRequired = status === "setup";

  /* 回车提交：提交按钮挂在右栏（form 之外），靠 htmlType="submit" + form 属性
     关联到本表单。这里再补一道显式 onPressEnter —— 既保证各浏览器一致，
     也顺带阻止隐式的第二次提交。 */
  const submitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    void handleRegister();
  };

  return (
    <div className={styles.shell}>
      {/* ─── 背景层 ─── */}
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
                {t("register.eyebrow")}
              </div>
              <h1 className={styles.h1}>
                {t("register.headline")}
                <span className={styles.gradText}>{t("register.headlineGrad")}</span>
              </h1>
              <p className={styles.lead}>{t("register.lead")}</p>

              {setupRequired ? (
                <div className={regStyles.setupNotice} role="note">
                  <div className={regStyles.setupNoticeTitle}>
                    <ShieldCheck size={14} /> {t("register.setupTitle")}
                  </div>
                  <p className={regStyles.setupNoticeDesc}>
                    {t("register.setupDesc")}
                  </p>
                  <Link to="/setup" className={regStyles.setupNoticeLink}>
                    {t("register.setupCta")}
                  </Link>
                </div>
              ) : (
                <form
                  id="register-form"
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRegister();
                  }}
                >
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="register-code">
                      {t("register.inviteLabel")}
                    </label>
                    <Input
                      id="register-code"
                      prefix={<KeyRound size={16} />}
                      placeholder={t("register.invitePlaceholder")}
                      size="large"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      onPressEnter={submitOnEnter}
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="register-username">
                      {t("register.usernameLabel")}
                    </label>
                    <Input
                      id="register-username"
                      prefix={<User size={16} />}
                      placeholder={t("register.usernamePlaceholder")}
                      size="large"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onPressEnter={submitOnEnter}
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="register-email">
                      {t("register.emailLabel")}{" "}
                      <span className={regStyles.labelOpt}>
                        {t("register.emailOptional")}
                      </span>
                    </label>
                    <Input
                      id="register-email"
                      type="email"
                      prefix={<Mail size={16} />}
                      placeholder={t("register.emailPlaceholder")}
                      size="large"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onPressEnter={submitOnEnter}
                    />
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="register-password">
                      {t("register.passwordLabel")}
                    </label>
                    <div className={regStyles.inpWithEye}>
                      <Input
                        id="register-password"
                        prefix={<Lock size={16} />}
                        type={showPassword ? "text" : "password"}
                        placeholder={t("register.passwordPlaceholder")}
                        size="large"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onPressEnter={submitOnEnter}
                      />
                      <button
                        type="button"
                        className={regStyles.eyeBtn}
                        aria-label={t("register.togglePassword")}
                        aria-pressed={showPassword}
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div
                      className={`${regStyles.strength} ${
                        password ? regStyles[`s${score}`] : ""
                      }`}
                      aria-hidden="true"
                    >
                      <i />
                      <i />
                      <i />
                    </div>
                    <div
                      className={`${regStyles.strengthTxt} ${
                        password ? regStyles[`w${score}`] : ""
                      }`}
                    >
                      {password
                        ? t(`register.strength${score}`)
                        : t("register.strength0")}
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="register-confirm">
                      {t("register.confirmLabel")}
                    </label>
                    <div className={regStyles.inpWithEye}>
                      <Input
                        id="register-confirm"
                        prefix={<ShieldCheck size={16} />}
                        type={showConfirm ? "text" : "password"}
                        placeholder={t("register.confirmPlaceholder")}
                        size="large"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onPressEnter={submitOnEnter}
                      />
                      <button
                        type="button"
                        className={regStyles.eyeBtn}
                        aria-label={t("register.toggleConfirm")}
                        aria-pressed={showConfirm}
                        onClick={() => setShowConfirm((v) => !v)}
                      >
                        {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div
                      className={`${regStyles.match} ${
                        confirmPassword
                          ? confirmPassword === password
                            ? regStyles.matchOk
                            : regStyles.matchBad
                          : ""
                      }`}
                    >
                      {confirmPassword
                        ? confirmPassword === password
                          ? t("register.matchOk")
                          : t("register.matchBad")
                        : ""}
                    </div>
                  </div>

                  <div className={styles.rowMeta}>
                    <label className={regStyles.agree}>
                      <input
                        type="checkbox"
                        className={regStyles.agreeInput}
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                      />
                      <span className={regStyles.agreeBox}>
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="m5 12.5 4.5 4.5L19 7" />
                        </svg>
                      </span>
                      <span>
                        {t("register.agreePrefix")}
                        <a
                          href="#"
                          className={regStyles.agreeLink}
                          onClick={(e) => e.preventDefault()}
                        >
                          {t("register.tos")}
                        </a>
                        {t("register.agreeAnd")}
                        <a
                          href="#"
                          className={regStyles.agreeLink}
                          onClick={(e) => e.preventDefault()}
                        >
                          {t("register.privacy")}
                        </a>
                      </span>
                    </label>
                  </div>
                </form>
              )}

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
                {t("register.actBadge")}
              </span>

              <h2 className={styles.actTitle}>{t("register.actTitle")}</h2>
              <p className={styles.actDesc}>{t("register.actDesc")}</p>

              {setupRequired ? (
                <Button
                  type="primary"
                  size="large"
                  block
                  className={styles.btnPrimary}
                  onClick={() => navigate("/setup")}
                >
                  {t("register.setupCta")}
                  <ArrowRight size={16} />
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="large"
                  block
                  loading={submitting}
                  htmlType="submit"
                  form="register-form"
                  disabled={status !== "open"}
                  className={styles.btnPrimary}
                >
                  {t("register.submit")}
                  <ArrowRight size={16} />
                </Button>
              )}

              <p className={styles.swap}>
                {t("register.haveAccount")}
                <Link to="/login" className={styles.swapLink}>
                  {t("register.signInCta")}
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
                        {t("register.ssoWith", { name: providerLabel(provider, t) })}
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
