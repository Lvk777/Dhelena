import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("[ErrorBoundary] Render error:", error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback(this.state.error, this.handleRetry);
            }
            return (
                <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
                    <AlertCircle className="w-8 h-8 text-rose" strokeWidth={1.5} />
                    <p className="text-sm text-muted-foreground max-w-xs">
                        {this.props.message || "Não foi possível carregar este conteúdo. Tente novamente."}
                    </p>
                    <button onClick={this.handleRetry} className="btn-outline flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" strokeWidth={1.5} /> Tentar novamente
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
