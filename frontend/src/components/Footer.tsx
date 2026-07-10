import { APP_VERSION } from '../version';

const CHANGELOG_URL = 'https://github.com/maxcheese3/ReceiptPrinterClub/blob/main/CHANGELOG.md';

export default function Footer() {
  return (
    <footer>
      <span>ReceiptPrinterClub &copy; 2026</span>
      <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
        v{APP_VERSION}
      </a>
    </footer>
  );
}
