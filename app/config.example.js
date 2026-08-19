// Copy to config.js (gitignored) and fill in your bridge server.
module.exports = {
  SERVER: '192.168.1.100:8788',        // LAN IP or tailscale name of the bridge
  TOKEN: 'contents-of-.token-file',    // printed by server.js on boot
};
