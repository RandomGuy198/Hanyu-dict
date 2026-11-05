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
import { usePreferences, useToast } from '../../app/providers';
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
  const toast = useToast();

  const [resetOpen, setResetOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installNote, setInstallNote] = useState('');

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
