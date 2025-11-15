class WebsiteFetcher {
    constructor() {
        this.form = document.getElementById('fetch-form');
        this.urlInput = document.getElementById('url-input');
        this.fetchBtn = document.getElementById('fetch-btn');
        this.loading = document.getElementById('loading');
        this.result = document.getElementById('result');
        this.previewFrame = document.getElementById('preview-frame');
        this.error = document.getElementById('error');
        this.errorMessage = document.getElementById('error-message');
        this.closeBtn = document.getElementById('close-btn');

        this.init();
    }

    init() {
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
        this.closeBtn.addEventListener('click', () => this.closePreview());
        
        // Optional: Add some example URLs for quick testing
        this.addExampleUrls();
    }

    addExampleUrls() {
        const examples = [
            'https://example.com',
            'https://httpbin.org/html',
            'https://renderguide.com'
        ];

        const exampleContainer = document.createElement('div');
        exampleContainer.style.marginTop = '10px';
        exampleContainer.style.fontSize = '14px';
        exampleContainer.innerHTML = `
            <span style="color: #666;">Try: </span>
            ${examples.map(url => 
                `<a href="#" class="example-url" data-url="${url}">${url}</a>`
            ).join(' | ')}
        `;

        this.form.appendChild(exampleContainer);

        // Add click handlers for example URLs
        document.querySelectorAll('.example-url').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.urlInput.value = e.target.getAttribute('data-url');
                this.form.dispatchEvent(new Event('submit'));
            });
        });
    }

    async handleSubmit(e) {
        e.preventDefault();
        
        const url = this.urlInput.value.trim();
        if (!url) return;

        this.showLoading();
        this.hideError();
        this.hideResult();

        try {
            await this.fetchWebsite(url);
        } catch (error) {
            this.showError(`Failed to fetch website: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async fetchWebsite(url) {
        // For static deployment, we'll use a CORS proxy approach
        // Note: For production, you should set up your own proxy server
        const proxyUrl = this.getProxyUrl(url);
        
        const response = await fetch(proxyUrl, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml',
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();
        this.displayWebsite(html, url);
    }

    getProxyUrl(url) {
        // Using a public CORS proxy for demonstration
        // In production, deploy your own proxy to avoid limitations
        return `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    }

    displayWebsite(html, originalUrl) {
        // For the CORS proxy response structure
        let content = html;
        if (html.includes('"contents"')) {
            try {
                const data = JSON.parse(html);
                content = data.contents;
            } catch (e) {
                console.warn('Failed to parse proxy response as JSON');
            }
        }

        // Create a blob URL to display the content
        const blob = new Blob([content], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);
        
        this.previewFrame.src = blobUrl;
        this.showResult();
    }

    showLoading() {
        this.fetchBtn.disabled = true;
        this.fetchBtn.textContent = 'Fetching...';
        this.loading.classList.remove('hidden');
    }

    hideLoading() {
        this.fetchBtn.disabled = false;
        this.fetchBtn.textContent = 'Fetch Website';
        this.loading.classList.add('hidden');
    }

    showResult() {
        this.result.classList.remove('hidden');
    }

    hideResult() {
        this.result.classList.add('hidden');
        if (this.previewFrame.src) {
            URL.revokeObjectURL(this.previewFrame.src);
        }
    }

    showError(message) {
        this.errorMessage.textContent = message;
        this.error.classList.remove('hidden');
    }

    hideError() {
        this.error.classList.add('hidden');
    }

    closePreview() {
        this.hideResult();
        this.urlInput.focus();
    }
}

// Initialize the fetcher when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new WebsiteFetcher();
});
