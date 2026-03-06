// Agregar al final de app.js para debugging
window.arbokDebug = {
  lastError: null,
  lastGasInfo: null,
  lastTxParams: null,
  
  captureError(error, context = '') {
    this.lastError = {
      context,
      message: error?.message,
      details: extractErrorDetails(error),
      timestamp: new Date().toISOString(),
      stack: error?.stack
    };
    console.log('[ARBOK DEBUG]', this.lastError);
    return this.lastError;
  },
  
  export() {
    return JSON.stringify({
      lastError: this.lastError,
      lastGasInfo: this.lastGasInfo,
      lastTxParams: this.lastTxParams,
      walletAddress,
      chainId: ARKIV_CHAIN_ID,
      rpcUrl: ARKIV_RPC_URL
    }, null, 2);
  }
};

console.log('Arbok Debug activado. Usa window.arbokDebug.export() para obtener info completa.');
