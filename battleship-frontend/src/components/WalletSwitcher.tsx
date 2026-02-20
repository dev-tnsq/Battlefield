import { useMemo } from 'react';
import { useWallet } from '../hooks/useWallet';
import './WalletSwitcher.css';

export function WalletSwitcher() {
  const {
    publicKey,
    isConnected,
    isConnecting,
    walletType,
    error,
    connectWallet,
    disconnect,
  } = useWallet();

  const walletLabel = useMemo(() => {
    return walletType === 'dev' ? 'Dev wallet connected' : 'Wallet connected';
  }, [walletType]);

  if (!isConnected) {
    return (
      <div className="wallet-switcher">
        <div className="wallet-actions-row">
          <button className="switch-button" onClick={() => connectWallet()} disabled={isConnecting}>
            Connect Wallet
          </button>
        </div>
        {error ? (
          <div className="wallet-error">
            <div className="error-title">Connection Failed</div>
            <div className="error-message">{error}</div>
          </div>
        ) : (
          <div className={`wallet-status ${isConnecting ? 'connecting' : 'idle'}`}>
            <span className="status-indicator"></span>
            <span className="status-text">{isConnecting ? 'Connecting wallet...' : 'Wallet not connected yet'}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="wallet-switcher">
      {error && (
        <div className="wallet-error">
          {error}
        </div>
      )}

      <div className="wallet-info">
        <div className="wallet-status connected">
          <span className="status-indicator"></span>
          <div className="wallet-details">
            <div className="wallet-label">{walletLabel}</div>
            <div className="wallet-address">
              {publicKey ? `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}` : ''}
            </div>
          </div>
          <div className="wallet-controls">
            {walletType === 'wallet' && (
              <button
                onClick={() => connectWallet()}
                className="switch-button ghost"
                disabled={isConnecting}
              >
                Change Wallet
              </button>
            )}
            <button onClick={() => disconnect()} className="switch-button ghost" disabled={isConnecting}>
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
