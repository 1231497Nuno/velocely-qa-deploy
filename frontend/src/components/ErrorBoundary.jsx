import { Component } from "react";

/**
 * Evita ecrã branco: captura erros de render e oferece UI de recuperação.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof console !== "undefined") {
      console.error("UI error:", error, info?.componentStack);
    }
  }

  reset = () => {
    this.setState({ error: null });
    if (typeof this.props.onReset === "function") this.props.onReset();
  };

  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || "Erro inesperado";
      return (
        <div className="min-h-[40vh] flex items-center justify-center p-6" data-testid="error-boundary">
          <div className="max-w-md w-full bg-white border border-gray-200 rounded-sm p-6 space-y-3 text-center">
            <h2 className="font-display text-lg text-gray-900">Algo correu mal</h2>
            <p className="text-sm text-gray-600">
              A página falhou a carregar. Pode tentar outra vez sem perder a sessão.
            </p>
            <p className="text-xs text-gray-400 break-words">{msg}</p>
            <div className="flex flex-wrap gap-2 justify-center pt-1">
              <button
                type="button"
                onClick={this.reset}
                className="bg-black text-white hover:bg-gray-800 rounded-sm px-4 py-2 text-sm font-medium"
              >
                Tentar novamente
              </button>
              <button
                type="button"
                onClick={() => { window.location.href = "/"; }}
                className="bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 rounded-sm px-4 py-2 text-sm font-medium"
              >
                Ir ao início
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
