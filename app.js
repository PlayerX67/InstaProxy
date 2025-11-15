const express = require('express');
const Rammerhead = require('rammerhead');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');

class RammerheadProxy {
    constructor() {
        this.app = express();
        this.rh = new Rammerhead({
            storage: {
                type: 'memory',
                sessionSettings: {
                    crossDomain: true,
                    disableCache: true,
                    forwardOrigin: false
                }
            }
        });
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupRammerhead();
    }

    setupMiddleware() {
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false
        }));
        
        this.app.use(compression());
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // CORS for proxy functionality
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            next();
        });

        // Static files
        this.app.use(express.static(path.join(__dirname, 'public')));
    }

    setupRammerhead() {
        // Rammerhead proxy middleware
        this.rh_proxy = this.rh.proxy();
        this.rh_browser = this.rh.browser();
    }

    setupRoutes() {
        // Health check endpoint for Render
        this.app.get('/health', (req, res) => {
            res.json({ status: 'OK', timestamp: new Date().toISOString() });
        });

        // Main proxy endpoint
        this.app.all('/proxy/*', (req, res) => {
            this.rh_proxy(req, res);
        });

        // Browser session endpoint
        this.app.all('/browser/*', (req, res) => {
            this.rh_browser(req, res);
        });

        // Session management
        this.app.post('/session', (req, res) => {
            try {
                const session = this.rh.createSession();
                res.json({ 
                    success: true, 
                    session: session,
                    sessionUrl: `/browser/${session}/`
                });
            } catch (error) {
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        // Get session info
        this.app.get('/session/:id', (req, res) => {
            try {
                const session = req.params.id;
                const info = this.rh.getSession(session);
                res.json({ 
                    success: true, 
                    session: session,
                    info: info 
                });
            } catch (error) {
                res.status(404).json({ 
                    success: false, 
                    error: 'Session not found' 
                });
            }
        });

        // Home page
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        });

        // Session creation page
        this.app.get('/create-session', (req, res) => {
            res.sendFile(path.join(__dirname, 'public', 'session.html'));
        });
    }

    start(port = process.env.PORT || 3000) {
        this.server = this.app.listen(port, '0.0.0.0', () => {
            console.log(`
🚀 Rammerhead Proxy Server Running!
📍 Local: http://localhost:${port}
🌐 Network: http://0.0.0.0:${port}
📊 Health: http://localhost:${port}/health
🔄 Sessions: http://localhost:${port}/create-session

✅ Ready for deployment on Render!
            `);
        });

        return this.server;
    }
}

// Start the server
const proxyServer = new RammerheadProxy();
const PORT = process.env.PORT || 3000;
proxyServer.start(PORT);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    proxyServer.server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});
