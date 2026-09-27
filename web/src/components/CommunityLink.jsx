import { COMMUNITY } from '../lib/constants.js';

/**
 * Join link for the surau youth programme's WhatsApp group.
 *
 * This is a *community* channel (program updates, announcements, photos) — not
 * technical support — so every surface labels it consistently and uses the
 * store's green so it reads as "WhatsApp" at a glance.
 *
 * `variant`:
 *   - 'button'  a solid WhatsApp-green call to action
 *   - 'icon'    a compact icon-only button for tight spots (top bar, kiosk)
 *   - 'card'    a full card with title + description (Home, notices)
 *   - 'link'    a plain text link
 */
export default function CommunityLink({ variant = 'button', className = '', block = false }) {
  const { whatsappUrl, name, description, label } = COMMUNITY;

  if (variant === 'card') {
    return (
      <div className={`card community-card ${className}`}>
        <div className="community-card-head">
          <span className="community-icon" aria-hidden="true">💬</span>
          <div>
            <h2 className="card-title" style={{ margin: 0 }}>Join our {label}</h2>
            <div className="muted" style={{ fontSize: '0.85rem' }}>{name}</div>
          </div>
        </div>
        <p className="muted" style={{ margin: '10px 0 14px' }}>{description}</p>
        <a
          className="btn community-btn"
          style={{ display: 'block', textAlign: 'center' }}
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
        >
          💬 Join the {label}
        </a>
      </div>
    );
  }

  if (variant === 'icon') {
    return (
      <a
        className={`btn-ghost community-icon-btn ${className}`}
        href={whatsappUrl}
        target="_blank"
        rel="noreferrer"
        title={`Join our ${label} for program updates`}
        aria-label={`Join our ${label} for program updates`}
      >
        <span aria-hidden="true">💬</span>
      </a>
    );
  }

  if (variant === 'link') {
    return (
      <a className={className} href={whatsappUrl} target="_blank" rel="noreferrer">
        💬 {label}
      </a>
    );
  }

  return (
    <a
      className={`btn community-btn ${block ? 'btn-block' : ''} ${className}`}
      style={block ? { display: 'block', textAlign: 'center' } : undefined}
      href={whatsappUrl}
      target="_blank"
      rel="noreferrer"
    >
      💬 Join the {label}
    </a>
  );
}
