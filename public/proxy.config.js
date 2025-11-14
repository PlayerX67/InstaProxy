self.__proxy$config = {
  prefix: '/service/',
  encodeUrl: function(url) {
    return btoa(url); // Base64 encode snippet from Scramjet
  },
  decodeUrl: function(encoded) {
    return atob(encoded); // Base64 decode
  },
  handler: '/proxy.handler.js',
  client: '/proxy.client.js',
  sw: '/proxy.sw.js'
};
