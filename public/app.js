class WebsiteFetcher {
  constructor() {
    this.currentUrl = '';
    this.currentData = null;
    this.isLoading = false;
    this.init();
  }

  init() {
    this.render();
    this.attachEventListeners();
  }

  render() {
    document.getElementById('app').innerHTML = `
      <div class="header">
        <div class="header-content">
          <div class="logo">
            <div class="logo-icon">🌐</div>
            Website Fetcher
          </div>
          <div class="search-section">
            <div class="search-input-wrapper">
              <span class="search-icon">🔍</span>
              <input
                type="text"
                class="search-input"
                id="urlInput"
                placeholder="Enter any URL (e.g., https://google.com)"
                value="${this.currentUrl}"
              />
            </div>
            <button class="btn btn-primary" id="fetchBtn">
              <span id="fetchBtnText">Fetch</span>
            </button>
            <button class="btn btn-secondary" id="openNewTabBtn" style="display: ${this.currentUrl ? 'flex' : 'none'};">
              ↗️ Open
            </button>
            <button class="btn btn-secondary" id="copyUrlBtn" style="display: ${this.currentUrl ? 'flex' : 'none'};">
              📋 Copy
            </button>
          </div>
        </div>
      </div>

      <div class="main-content">
        <div class="preview-section">
          <div id="preview" class="preview-container">
            ${this.getPreviewContent()}
          </div>
        </div>
        <div class="sidebar" id="sidebar" style="display: ${this.currentData ? 'flex' : 'none'};">
          <div class="sidebar-section">
            <div class="sidebar-title">Page Info</div>
            <div class="metric">
              <span class="metric-label">Title</span>
              <span class="metric-value" style="max-width: 150px; overflow: hidden; text-overflow: ellipsis;">${this.currentData?.title || 'N/A'}</span>
            </div>
            <div class="metric">
              <span class="metric-label">URL</span>
              <span class="metric-value" style="font-size: 11px; max-width: 150px; overflow: hidden; text-overflow: ellipsis;">${this.currentUrl || 'N/A'}</span>
            </div>
          </div>

          ${this.currentData?.metrics ? `
            <div class="sidebar-section">
              <div class="sidebar-title">Performance</div>
              <div class="metric">
                <span class="metric-label">JS Heap</span>
                <span class="metric-value">${this.formatBytes(this.currentData.metrics.JSHeapUsedSize)}</span>
              </div>
              <div class="metric">
                <span class="metric-label">Total Heap</span>
                <span class="metric-value">${this.formatBytes(this.currentData.metrics.JSHeapTotalSize)}</span>
              </div>
            </div>
          ` : ''}

          <div class="sidebar-section actions-section">
            <div class="sidebar-title">Actions</div>
            <button class="action-btn" id="screenshotBtn">
              <span class="action-btn-icon">📸</span>
              Download Screenshot
            </button>
            <button class="action-btn" id="openFullPageBtn">
              <span class="action-btn-icon">🌍</span>
              View Full Page
            </button>
            <button class="action-btn" id="refreshBtn">
              <span class="action-btn-icon">🔄</span>
              Re-render
            </button>
            <button class="action-btn" id="clearBtn">
              <span class="action-btn-icon">🗑️</span>
              Clear
            </button>
          </div>
        </div>
      </div>
    `;
  }

  getPreviewContent() {
    if (!this.currentUrl) {
      return `
        <div class="empty-state">
          <div class="empty-icon">🌍</div>
          <div class="empty-title">Website Fetcher</div>
          <div class="empty-description">
            Enter any URL above to fetch and render websites with perfect fidelity.
            Screenshot preview, then view the fully functional live version.
          </div>
        </div>
      `;
    }

    if (this.isLoading) {
      return `
        <div class="preview-loading">
          <div class="loading-spinner"></div>
          <div class="loading-text">
            <p>Rendering website...</p>
            <p style="font-size: 12px;">Taking screenshot with full rendering</p>
          </div>
        </div>
      `;
    }

    if (this.currentData) {
      const toolbarUrl = this.currentUrl.length > 50 
        ? this.currentUrl.substring(0, 50) + '...' 
        : this.currentUrl;

      return `
        <div class="preview-toolbar">
          <div class="preview-url" title="${this.currentUrl}">🔗 ${toolbarUrl}</div>
        </div>
        <img src="data:image/png;base64,${this.currentData.screenshot}" class="preview-image" />
      `;
    }

    return '';
  }

  attachEventListeners() {
    const fetchBtn = document.getElementById('fetchBtn');
    const urlInput = document.getElementById('urlInput');
    const openNewTabBtn = document.getElementById('openNewTabBtn');
    const copyUrlBtn = document.getElementById('copyUrlBtn');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const openFullPageBtn = document.getElementById('openFullPageBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const clearBtn = document.getElementById('clearBtn');

    fetchBtn.addEventListener('click', () => this.fetchWebsite());
    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.fetchWebsite();
    });
    urlInput.addEventListener('input', (e) => {
      this.currentUrl = e.target.value.trim();
    });

    if (openNewTabBtn) {
      openNewTabBtn.addEventListener('click', () => {
        window.open(this.currentUrl, '_blank');
      });
    }

    if (copyUrlBtn) {
      copyUrlBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(this.currentUrl);
        copyUrlBtn.textContent = '✓ Copied!';
        setTimeout(() => {
          copyUrlBtn.innerHTML = '📋 Copy';
        }, 2000);
      });
    }

    if (screenshotBtn) {
      screenshotBtn.addEventListener('click', () => this.downloadScreenshot());
    }

    if (openFullPageBtn) {
      openFullPageBtn.addEventListener('click', () => this.openFullPage());
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.fetchWebsite());
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clear());
    }
  }

  async fetchWebsite() {
    const urlInput = document.getElementById('urlInput');
    let url = urlInput.value.trim();

    if (!url) {
      alert('Please enter a URL');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    this.currentUrl = url;
    this.isLoading = true;
    this.render();
    this.attachEventListeners();

    try {
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: this.currentUrl,
          fullPage: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to render website');
      }

      this.currentData = data;
      this.isLoading = false;
      this.render();
      this.attachEventListeners();
    } catch (error) {
      this.isLoading = false;
      alert(`Error: ${error.message}`);
      this.render();
      this.attachEventListeners();
    }
  }

  async openFullPage() {
    if (!this.currentUrl) {
      alert('No URL loaded');
      return;
    }

    try {
      const response = await fetch('/api/open-page', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: this.currentUrl,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to open page');
      }

      const width = window.innerWidth * 0.9;
      const height = window.innerHeight * 0.9;
      const left = (window.innerWidth - width) / 2;
      const top = (window.innerHeight - height) / 2;

      window.open(
        data.proxyUrl,
        'proxied-page',
        `width=${width},height=${height},left=${left},top=${top}`
      );
    } catch (error) {
      alert(`Error: ${error.message}`);
    }
  }

  downloadScreenshot() {
    if (!this.currentData || !this.currentData.screenshot) {
      alert('No screenshot available');
      return;
    }

    const link = document.createElement('a');
    link.href = `data:image/png;base64,${this.currentData.screenshot}`;
    link.download = `screenshot-${Date.now()}.png`;
    link.click();
  }

  clear() {
    this.currentUrl = '';
    this.currentData = null;
    this.isLoading = false;
    this.render();
    this.attachEventListeners();
    document.getElementById('urlInput').focus();
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new WebsiteFetcher();
  });
} else {
  new WebsiteFetcher();
}
