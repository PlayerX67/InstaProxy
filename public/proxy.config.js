self.__proxy$config = {
  prefix: '/scramjet/',
  encodeUrl: function(url) {
    return Buffer.from(url).toString('base64');  // Node-style base64 for consistency
  },
  decodeUrl: function(encoded) {
    return Buffer.from(encoded, 'base64').toString();
  },
  handler: '/proxy.handler.js',
  client: '/proxy.client.js',
  sw: '/proxy.sw.js'
};
