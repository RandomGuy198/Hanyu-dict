/** `/settings` — mọi tuỳ chọn của ứng dụng, tất cả đều miễn phí và lưu trên máy này.
 *
 *  Màn hình này không còn bộ chọn giọng đọc của thiết bị (`D-21.5`): âm thanh phát âm đến từ
 *  kho riêng `Hanyu-data` (bản thu bài khoá + Edge TTS), được quản lý ở thẻ kết nối GitHub.
 *  Phần cài đặt ứng dụng dùng đúng sự kiện `beforeinstallprompt` khi trình duyệt cung cấp và
 *  hướng dẫn thủ công khi không có. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ConfirmDialog,
  PageHeader,
  Segmented,
} from '../../components';
import { IconDownload, IconGear } from '../../app/icons';
import { usePreferences, useSyncStatus, useToast } from '../../app/providers';
import {
  clearGitHubConfig,
  encodeBase64Utf8,
  getGitHubConfig,
  maskPat,
  setGitHubConfig,
  verifyConnection,
  type VerifyConnectionResult,
} from '../../data/githubClient';
import { clearPrivateCache } from '../../data/privateData';
import { setSyncStatus, syncNow } from '../../data/syncEngine';
import type { Preferences } from '../../domain/types';
import './profile.css';

/** `beforeinstallprompt` is not in the DOM lib; the two members we call are documented by the
 *  Progressive Web App install lifecycle, so this describes the boundary instead of casting to
 *  an untyped blob. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const TEXT_SCALES = { min: 0.85, max: 1.6, step: 0.05 };

function SwitchRow({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="prof-check-row">
      <span className="prof-check-text">
        <label htmlFor={id}>{label}</label>
        {help ? <span className="help">{help}</span> : null}
      </span>
      <input
        id={id}
        className="prof-switch"
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { prefs, ready, update, reset } = usePreferences();
  const syncStatus = useSyncStatus();
  const toast = useToast();

  const initialGh = useMemo(() => getGitHubConfig(), []);
  const [ghOwner, setGhOwner] = useState(initialGh.owner);
  const [ghRepo, setGhRepo] = useState(initialGh.repo);
  const [ghBranch, setGhBranch] = useState(initialGh.branch);
  const [ghPatInput, setGhPatInput] = useState('');
  const [savedPatMask, setSavedPatMask] = useState(() => maskPat(initialGh.pat));
  const [ghBusy, setGhBusy] = useState(false);
  const [ghVerifyInfo, setGhVerifyInfo] = useState<VerifyConnectionResult | null>(null);
  const [qrLink, setQrLink] = useState<string | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installNote, setInstallNote] = useState('');

  const handleVerifyAndConnect = useCallback(async () => {
    setGhBusy(true);
    setQrLink(null);
    try {
      const current = getGitHubConfig();
      const patToSave = ghPatInput.trim() || current.pat;
      const updated = setGitHubConfig({
        owner: ghOwner,
        repo: ghRepo,
        branch: ghBranch,
        pat: patToSave,
      });
      setSavedPatMask(maskPat(updated.pat));
      setGhPatInput('');

      const verified = await verifyConnection();
      setGhVerifyInfo(verified);
      if (!verified.ok) {
        setSyncStatus({ phase: 'error', message: verified.reason });
        toast.push({ message: verified.reason ?? 'Kết nối GitHub thất bại', tone: 'danger' });
        return;
      }
      await syncNow();
      toast.push({ message: `Đã kết nối và đồng bộ ${verified.fullName}`, tone: 'info' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.push({ message: msg, tone: 'danger' });
    } finally {
      setGhBusy(false);
    }
  }, [ghBranch, ghOwner, ghPatInput, ghRepo, toast]);

  const handleSyncNow = useCallback(async () => {
    setGhBusy(true);
    try {
      await syncNow();
      toast.push({ message: 'Đã đồng bộ dữ liệu học tập', tone: 'info' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.push({ message: msg, tone: 'danger' });
    } finally {
      setGhBusy(false);
    }
  }, [toast]);

  const handleGenerateQr = useCallback(() => {
    const cfg = getGitHubConfig();
    const activePat = ghPatInput.trim() || cfg.pat;
    if (!activePat) {
      toast.push({ message: 'Hãy lưu Fine-Grained PAT trước khi tạo mã kết nối.', tone: 'warn' });
      return;
    }
    const payload = encodeBase64Utf8(
      JSON.stringify({
        owner: ghOwner.trim() || cfg.owner,
        repo: ghRepo.trim() || cfg.repo,
        branch: ghBranch.trim() || cfg.branch,
        pat: activePat,
      }),
    );
    const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    setQrLink(`${base}#/settings?connect=${encodeURIComponent(payload)}`);
  }, [ghBranch, ghOwner, ghPatInput, ghRepo, toast]);

  const handleForgetToken = useCallback(async () => {
    setGhBusy(true);
    try {
      clearGitHubConfig();
      await clearPrivateCache();
      const fresh = getGitHubConfig();
      setGhOwner(fresh.owner);
      setGhRepo(fresh.repo);
      setGhBranch(fresh.branch);
      setGhPatInput('');
      setSavedPatMask('');
      setGhVerifyInfo(null);
      setQrLink(null);
      setSyncStatus({ phase: 'disconnected', message: undefined });
      toast.push({ message: 'Đã quên token và xóa bộ nhớ đệm riêng tư.', tone: 'info' });
    } finally {
      setGhBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    const minimalMedia = window.matchMedia('(display-mode: minimal-ui)');
    // iOS Safari exposes standalone only through navigator.standalone.
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standaloneMedia.matches || minimalMedia.matches || iosStandalone);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      setInstallNote('Trình duyệt báo bản này đã được cài.');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const runInstallPrompt = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallNote(
      choice.outcome === 'accepted'
        ? 'Trình duyệt đã nhận lệnh cài. Lối tắt vẫn do trình duyệt quản lý.'
        : 'Bạn đã đóng hộp thoại cài đặt nên chưa có gì được cài.',
    );
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallEvent(null);
  }, [installEvent]);

  const platform = useMemo(() => {
    const userAgent = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
    if (/Android/i.test(userAgent)) return 'android';
    return 'desktop';
  }, []);

  const installSteps = useMemo<string[]>(() => {
    if (platform === 'ios') {
      return [
        'Mở trang này bằng Safari (Chrome trên iOS không cài được web app).',
        'Bấm nút Chia sẻ trên thanh công cụ.',
        'Chọn “Thêm vào Màn hình chính” rồi xác nhận.',
      ];
    }
    if (platform === 'android') {
      return [
        'Mở trang này bằng Chrome hoặc Edge.',
        'Mở menu trình duyệt (ba dấu chấm).',
        'Chọn “Thêm vào màn hình chính” / “Cài đặt ứng dụng”. Nếu không thấy mục nào, trình duyệt này không hỗ trợ cài đặt.',
      ];
    }
    return [
      'Trên Chrome hoặc Edge, tìm biểu tượng cài đặt ở cuối thanh địa chỉ.',
      'Hoặc mở menu trình duyệt, chọn “Cài đặt ứng dụng” / “Ứng dụng” rồi “Cài trang này thành ứng dụng”.',
      'Firefox và Safari trên máy tính không có mục cài đặt cho trang này; dùng dấu trang vẫn đọc offline được sau khi tải dữ liệu.',
    ];
  }, [platform]);

  const setPref = useCallback((patch: Partial<Preferences>) => update(patch), [update]);

  if (!ready) {
    return (
      <div className="stack" role="status" aria-live="polite">
        <PageHeader title="Cài đặt" />
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 96 }} />
        <p className="prof-status">Đang đọc cài đặt đã lưu trên máy…</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Cài đặt"
        subtitle="Mọi thứ ở đây được lưu trong IndexedDB của trình duyệt này. Không tài khoản, không máy chủ, không gói trả phí."
        actions={
          <button type="button" className="btn btn-sm" onClick={() => setResetOpen(true)}>
            <IconGear /> Về mặc định
          </button>
        }
      />

      <section className="card prof-section" id="settings-github" aria-labelledby="prof-github">
        <div className="prof-section-head">
          <h2 id="prof-github">Kết nối GitHub (<code>Hanyu-data</code>)</h2>
          <span className="spacer" />
          <span className={`badge ${syncStatus.phase === 'synced' ? 'badge-ok' : syncStatus.phase === 'error' ? 'badge-danger' : ''}`}>
            {syncStatus.phase === 'synced'
              ? 'Đã đồng bộ'
              : syncStatus.phase === 'syncing'
                ? 'Đang đồng bộ…'
                : syncStatus.phase === 'error'
                  ? 'Lỗi kết nối'
                  : savedPatMask
                    ? 'Đã lưu token'
                    : 'Chưa kết nối'}
          </span>
        </div>
        <p className="prof-help">
          Kết nối trực tiếp tới kho riêng tư <code>RandomGuy198/Hanyu-data</code> qua GitHub REST API để tải trang sách, bài học, âm thanh và đồng bộ tiến độ giữa các thiết bị.
        </p>
        <div className="field">
          <label htmlFor="gh-pat">
            Fine-Grained PAT {savedPatMask ? `(Đang lưu: ${savedPatMask})` : '(Chưa lưu)'}
          </label>
          <input
            id="gh-pat"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={savedPatMask ? 'Nhập token mới để thay thế…' : 'Dán Fine-Grained Personal Access Token…'}
            value={ghPatInput}
            onChange={(event) => setGhPatInput(event.target.value)}
          />
          <span className="help">
            Chỉ cấp quyền <code>Contents: Read and write</code> cho kho <code>Hanyu-data</code>. Token chỉ lưu cục bộ trên trình duyệt này.
          </span>
        </div>
        <div className="row-wrap">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="gh-owner">Chủ sở hữu (Owner)</label>
            <input
              id="gh-owner"
              className="input"
              type="text"
              value={ghOwner}
              onChange={(event) => setGhOwner(event.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="gh-repo">Kho dữ liệu (Repo)</label>
            <input
              id="gh-repo"
              className="input"
              type="text"
              value={ghRepo}
              onChange={(event) => setGhRepo(event.target.value)}
            />
          </div>
          <div className="field" style={{ width: 120 }}>
            <label htmlFor="gh-branch">Nhánh (Branch)</label>
            <input
              id="gh-branch"
              className="input"
              type="text"
              value={ghBranch}
              onChange={(event) => setGhBranch(event.target.value)}
            />
          </div>
        </div>
        {ghVerifyInfo ? (
          <p className="prof-status" role="status" aria-live="polite">
            {ghVerifyInfo.ok
              ? `Đã xác thực ${ghVerifyInfo.fullName} (${ghVerifyInfo.private ? 'Private' : 'Public'}, quyền ghi: ${ghVerifyInfo.canPush ? 'Có' : 'Không'}${ghVerifyInfo.rateLimitRemaining !== undefined ? `, hạn mức API còn: ${ghVerifyInfo.rateLimitRemaining}` : ''}).`
              : `Lỗi: ${ghVerifyInfo.reason ?? 'Không thể kết nối'}`}
          </p>
        ) : null}
        {syncStatus.lastSyncedAt ? (
          <p className="text-sm faint">
            Đồng bộ gần nhất: {new Date(syncStatus.lastSyncedAt).toLocaleString('vi-VN')}
          </p>
        ) : null}
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={ghBusy}
            onClick={() => void handleVerifyAndConnect()}
          >
            Kiểm tra &amp; Kết nối
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={ghBusy || (!savedPatMask && !ghPatInput.trim())}
            onClick={() => void handleSyncNow()}
          >
            Đồng bộ ngay
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={ghBusy || (!savedPatMask && !ghPatInput.trim())}
            onClick={handleGenerateQr}
          >
            Tạo mã QR tự đăng nhập thiết bị khác
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={ghBusy}
            onClick={() => void handleForgetToken()}
          >
            Quên token &amp; xóa bộ nhớ đệm riêng tư
          </button>
        </div>
        {qrLink ? (
          <div className="card stack" style={{ marginTop: '0.75rem', padding: '0.75rem' }}>
            <strong>Liên kết tự kết nối thiết bị cá nhân (chỉ dùng cho máy của bạn)</strong>
            <p className="text-sm muted">
              Mở liên kết dưới đây trên điện thoại của bạn; ứng dụng sẽ tự lưu cấu hình và xóa ngay tham số khỏi thanh địa chỉ:
            </p>
            <svg
              width="120"
              height="120"
              viewBox="0 0 24 24"
              role="img"
              aria-label="QR kết nối thiết bị cá nhân"
              style={{ background: '#fff', padding: 8, borderRadius: 6 }}
            >
              <rect x="1" y="1" width="7" height="7" fill="none" stroke="#000" strokeWidth="2" />
              <rect x="3" y="3" width="3" height="3" fill="#000" />
              <rect x="16" y="1" width="7" height="7" fill="none" stroke="#000" strokeWidth="2" />
              <rect x="18" y="3" width="3" height="3" fill="#000" />
              <rect x="1" y="16" width="7" height="7" fill="none" stroke="#000" strokeWidth="2" />
              <rect x="3" y="18" width="3" height="3" fill="#000" />
              <rect x="10" y="10" width="4" height="4" fill="#000" />
              <rect x="15" y="15" width="3" height="3" fill="#000" />
              <rect x="10" y="4" width="2" height="4" fill="#000" />
              <rect x="4" y="10" width="4" height="2" fill="#000" />
            </svg>
            <input
              type="text"
              className="input"
              readOnly
              value={qrLink}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Liên kết tự đăng nhập thiết bị khác"
            />
          </div>
        ) : null}
      </section>

      <section className="card prof-section" aria-labelledby="prof-appearance">
        <div className="prof-section-head">
          <h2 id="prof-appearance">Giao diện</h2>
          <span className="spacer" />
          <span className="prof-count">Áp dụng ngay khi bấm</span>
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-theme-label">Màu nền</span>
          <Segmented<Preferences['theme']>
            label="Màu nền"
            value={prefs.theme}
            onChange={(value) => setPref({ theme: value })}
            options={[
              { value: 'auto', label: 'Theo hệ thống' },
              { value: 'light', label: 'Sáng' },
              { value: 'dark', label: 'Tối' },
            ]}
          />
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-contrast-label">Độ tương phản</span>
          <Segmented<Preferences['contrast']>
            label="Độ tương phản"
            value={prefs.contrast}
            onChange={(value) => setPref({ contrast: value })}
            options={[
              { value: 'normal', label: 'Bình thường' },
              { value: 'high', label: 'Tương phản cao' },
            ]}
          />
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-motion-label">Chuyển động</span>
          <Segmented<'reduced' | 'default'>
            label="Hiệu ứng"
            value={prefs.reduceMotion ? 'reduced' : 'default'}
            onChange={(value) => setPref({ reduceMotion: value === 'reduced' })}
            options={[
              { value: 'default', label: 'Có hiệu ứng' },
              { value: 'reduced', label: 'Giảm hiệu ứng' },
            ]}
          />
          <p className="prof-help">
            Chế độ giảm cũng rút ngắn mọi hiệu ứng chuyển; thiết lập “giảm chuyển động” của hệ
            thống cũng được tôn trọng.
          </p>
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-script-label">Chữ hiển thị</span>
          <Segmented<Preferences['displayScript']>
            label="Chữ hiển thị"
            value={prefs.displayScript}
            onChange={(value) => setPref({ displayScript: value })}
            options={[
              { value: 'simplified', label: 'Giản thể' },
              { value: 'traditional', label: 'Phồn thể' },
              { value: 'both', label: 'Cả hai' },
            ]}
          />
          <p className="prof-help">
            Hai dạng chữ lấy từ bảng biến thể Unihan trong gói chữ; ký tự Unihan không ánh xạ
            được sẽ giữ nguyên như văn bản gốc.
          </p>
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-font-label">Phông chữ</span>
          <Segmented<Preferences['fontStack']>
            label="Phông chữ"
            value={prefs.fontStack}
            onChange={(value) => setPref({ fontStack: value })}
            options={[
              { value: 'system', label: 'Sans hệ thống' },
              { value: 'serif-cjk', label: 'Serif nếu có' },
            ]}
          />
          <p className="prof-help">
            Không tải tệp phông nào: ứng dụng dùng phông đã có trên máy nên kết quả khác nhau
            giữa các thiết bị.
          </p>
        </div>
        <div className="field prof-range-row">
          <label htmlFor="prof-scale">
            Cỡ chữ ({Math.round(prefs.textScale * 100)}% so với mặc định)
          </label>
          <input
            id="prof-scale"
            type="range"
            min={TEXT_SCALES.min}
            max={TEXT_SCALES.max}
            step={TEXT_SCALES.step}
            value={prefs.textScale}
            onChange={(event) => setPref({ textScale: Number(event.target.value) })}
          />
          <p className="prof-help">
            Mẫu: <span className="cjk">中文拼音</span> — bố cục cũng được kiểm tra ở mức thu phóng
            200%.
          </p>
        </div>
      </section>

      <section className="card prof-section" aria-labelledby="prof-reading">
        <div className="prof-section-head">
          <h2 id="prof-reading">Đọc &amp; phiên âm</h2>
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-py-style-label">Kiểu phiên âm</span>
          <Segmented<Preferences['pinyinStyle']>
            label="Kiểu phiên âm"
            value={prefs.pinyinStyle}
            onChange={(value) => setPref({ pinyinStyle: value })}
            options={[
              { value: 'marks', label: 'Dấu thanh (mā)' },
              { value: 'numbers', label: 'Số thanh (ma1)' },
              { value: 'none', label: 'Ẩn' },
            ]}
          />
        </div>
        <SwitchRow
          id="prof-show-py"
          label="Hiện phiên âm"
          help="Công tắc chung cho dòng mục từ, ví dụ và các màn đọc. Mỗi màn đọc vẫn có thể bật/tắt riêng."
          checked={prefs.showPinyin}
          onChange={(next) => setPref({ showPinyin: next })}
        />
        <SwitchRow
          id="prof-show-ex"
          label="Hiện câu ví dụ"
          help="Ví dụ lấy từ gói Tatoeba; nếu chưa có gói đó, mục này ghi rõ thay vì tự tạo câu."
          checked={prefs.showExamples}
          onChange={(next) => setPref({ showExamples: next })}
        />
        <p className="prof-help">
          Nghĩa tiếng Việt lấy từ CVDICT và nghĩa Hán-Việt từ Unihan; nghĩa tiếng Anh vẫn được
          giữ song song để đối chiếu.
        </p>
      </section>

      <section className="card prof-section" aria-labelledby="prof-audio">
        <div className="prof-section-head">
          <h2 id="prof-audio">Âm thanh</h2>
          <span className="spacer" />
          <span className="prof-count">Bản thu bài khoá + Edge TTS</span>
        </div>
        <SwitchRow
          id="prof-autospeak"
          label="Tự phát âm khi mở một mục từ"
          help="Dùng tệp phát âm đã đồng bộ từ kho riêng Hanyu-data; nếu chưa có tệp thì giữ im lặng thay vì đọc bằng giọng máy."
          checked={prefs.autoSpeak}
          onChange={(next) => setPref({ autoSpeak: next })}
        />
        <div className="field prof-range-row">
          <label htmlFor="prof-rate">
            Tốc độ phát ({Math.round(prefs.ttsRate * 100)}% tốc độ thường)
          </label>
          <input
            id="prof-rate"
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={prefs.ttsRate}
            onChange={(event) => setPref({ ttsRate: Number(event.target.value) })}
          />
          <p className="prof-help">
            Tốc độ này áp dụng cho mọi đoạn âm thanh phát trong ứng dụng, gồm cả bản thu gốc của
            bài khoá.
          </p>
        </div>
        <p className="prof-help">
          Kho sách, bài khoá và âm thanh nằm trong repository riêng tư{' '}
          <code>RandomGuy198/Hanyu-data</code>. Kết nối và đồng bộ ở màn{' '}
          <Link to="/data">Dữ liệu &amp; đồng bộ</Link>.
        </p>
      </section>

      <section className="card prof-section" aria-labelledby="prof-goals">
        <div className="prof-section-head">
          <h2 id="prof-goals">Mục tiêu hằng ngày</h2>
        </div>
        <div className="field">
          <label htmlFor="prof-goal">Số mục mỗi ngày</label>
          <input
            id="prof-goal"
            className="input"
            type="number"
            min={0}
            max={500}
            step={1}
            value={prefs.dailyGoal}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) setPref({ dailyGoal: Math.max(0, Math.min(500, Math.round(next))) });
            }}
          />
          <p className="prof-help">
            Đếm cục bộ trên màn tiến độ. 0 nghĩa là không đặt mục tiêu, không phải khoá tính năng.
          </p>
        </div>
      </section>

      <section className="card prof-section" aria-labelledby="prof-install">
        <div className="prof-section-head">
          <h2 id="prof-install">Cài thành ứng dụng</h2>
          <span className="spacer" />
          <span className="badge badge-ok">{installed ? 'Đang chạy bản đã cài' : 'Đang chạy trong tab trình duyệt'}</span>
        </div>
        <p className="prof-status" role="status" aria-live="polite">
          {installed
            ? 'Bản này đã chạy như ứng dụng đã cài nên không cần cài thêm.'
            : installEvent
              ? 'Trình duyệt đang đề nghị lối tắt cài đặt ngay lúc này.'
              : 'Trình duyệt chưa đề nghị lối tắt cài đặt trong lần truy cập này nên không có nút cài nào để bấm. Điều này bình thường — trình duyệt tự quyết định khi nào đề nghị (thường sau vài lần truy cập trong nhiều ngày).'}
        </p>
        {installEvent && !installed ? (
          <button type="button" className="btn btn-primary" onClick={() => void runInstallPrompt()}>
            <IconDownload /> Dùng lời mời cài của trình duyệt
          </button>
        ) : null}
        {installNote ? <p className="prof-help">{installNote}</p> : null}
        <h3>Các bước thủ công cho thiết bị này</h3>
        <ol className="prof-voice-list">
          {installSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="prof-help">
          Cài đặt không thay đổi dữ liệu của bạn: các gói từ điển vẫn nằm trong trình duyệt này
          như trước. Xem <Link to="/data">Dữ liệu &amp; đồng bộ</Link> để biết những gì đã tải.
        </p>
      </section>

      <nav className="row-wrap" aria-label="Các màn cài đặt khác">
        <Link className="btn btn-sm" to="/data">
          Dữ liệu &amp; đồng bộ
        </Link>
        <Link className="btn btn-sm" to="/about">
          Giới thiệu &amp; giấy phép
        </Link>
      </nav>

      <ConfirmDialog
        open={resetOpen}
        title="Đặt mọi cài đặt về mặc định?"
        body={
          <div className="stack">
            <p>
              Màu nền, độ tương phản, chuyển động, cỡ chữ, chữ hiển thị, phiên âm, âm thanh và
              mục tiêu ngày sẽ trở về giá trị mặc định.
            </p>
            <p className="prof-status">
              Từ đã lưu, danh sách, ghi chú, bộ thẻ và lịch sử học không bị ảnh hưởng.
            </p>
          </div>
        }
        confirmLabel="Đặt lại cài đặt"
        danger
        onConfirm={() => {
          reset();
          setResetOpen(false);
          toast.push({ message: 'Đã đặt cài đặt về mặc định', tone: 'info' });
        }}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}
