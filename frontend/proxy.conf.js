module.exports = {
  '/api': {
    target: process.env.BACKEND_PROXY || 'http://localhost:3000',
    changeOrigin: true,
  },
};
