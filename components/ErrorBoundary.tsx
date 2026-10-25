import { Component, type ErrorInfo, type ReactNode } from "react";
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Never render error details or private application state. */
  }
  render() {
    if (this.state.failed)
      return (
        <main className="access-screen">
          <section className="access-card" role="alert">
            <div className="brand-access">
              Cestou Zimy<span>PRÍPRAVA NA ZIMNÝ KURZ</span>
            </div>
            <h1>Zobrazenie sa nepodarilo dokončiť.</h1>
            <p>
              Aplikácia narazila na neočakávanú chybu. Skús ju znovu načítať.
              Záznamy už potvrdené serverom zostávajú uložené.
            </p>
            <button
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Znovu načítať aplikáciu
            </button>
          </section>
        </main>
      );
    return this.props.children;
  }
}
