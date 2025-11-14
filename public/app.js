class WebsiteFetcher {
  constructor() {
    this.init();
  }

  init() {
    this.render();
    this.attachListeners();
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
                autofocus
              />
            </div>
            <button class="btn btn-primary" id="fetchBtn">Load</button>
          </div>
        </div>
      </div>
      <iframe id="frame" class="frame"></iframe>
    `;
  }

  attachListeners() {
    document.getElementById('fetchBtn').addEventListener('click', () => this.fetch());
    document.getElementById('urlInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.fetch();
    });
  }

  fetch() {
    let url = document.getElementById('urlInput').value.trim();
    
    if (!url) {
      alert('Enter a URL');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    document.getElementById('frame').src = `/fetch?url=${encodeURIComponent(url)}`;
  }
}

new WebsiteFetcher();
