'use strict';
const MANIFEST = 'flutter-app-manifest';
const TEMP = 'flutter-temp-cache';
const CACHE_NAME = 'flutter-app-cache';

const RESOURCES = {"assets/AssetManifest.bin": "693635b5258fe5f1cda720cf224f158c",
"assets/AssetManifest.json": "2efbb41d7877d10aac9d091f58ccd7b9",
"assets/FontManifest.json": "dc3d03800ccca4601324923c0b1d6d57",
"assets/fonts/MaterialIcons-Regular.otf": "05f8c29dc60beaaddcf8d3949ec9b410",
"assets/NOTICES": "e8d2429d090de25bbd915c0398353c18",
"assets/packages/cupertino_icons/assets/CupertinoIcons.ttf": "57d849d738900cfd590e9adc7e208250",
"assets/shaders/ink_sparkle.frag": "f8b80e740d33eb157090be4e995febdf",
"canvaskit/canvaskit.js": "76f7d822f42397160c5dfc69cbc9b2de",
"canvaskit/canvaskit.wasm": "f48eaf57cada79163ec6dec7929486ea",
"canvaskit/chromium/canvaskit.js": "8c8392ce4a4364cbb240aa09b5652e05",
"canvaskit/chromium/canvaskit.wasm": "fc18c3010856029414b70cae1afc5cd9",
"canvaskit/skwasm.js": "1df4d741f441fa1a4d10530ced463ef8",
"canvaskit/skwasm.wasm": "6711032e17bf49924b2b001cef0d3ea3",
"canvaskit/skwasm.worker.js": "19659053a277272607529ef87acf9d8a",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-grid.css": "b10fac3301ad4633691ea1e112ee7a22",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-grid.css.map": "8bbd6ec4e97c6dc0f60d70f375af9622",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-grid.min.css": "495d455aab0295dc9d1bee6ed95a0da4",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-grid.min.css.map": "2768e0ba48e6842098b0cce180bf789a",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-grid.rtl.css": "e327ba9798a1d4cfb38708fc66bb1e47",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-grid.rtl.css.map": "f11a52edea503bbabc0d2a78c1dde683",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-grid.rtl.min.css": "feb5100bd4325777e378a070b0fe2b78",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-grid.rtl.min.css.map": "f7a6be8b10d9ce9b6e87f96a062dd74f",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-reboot.css": "a7ad96d0b8ab00ec19c2d5b4ea827ede",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-reboot.css.map": "5512953c7da319cb6a993fb3815e4b7e",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-reboot.min.css": "c4e7aba29e26f42c1b77e349b4dc6394",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-reboot.min.css.map": "a1b5e50121fc8ebfeeab14d7bb85060a",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-reboot.rtl.css": "dd5b1b1fb25690537a6bf5c19d920638",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-reboot.rtl.css.map": "b2cabd53991f1b3c72d417ce059d9e74",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-reboot.rtl.min.css": "5d40629fbff36cec983e2e4cddd71511",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-reboot.rtl.min.css.map": "09629fc7c05bb740ad8d6b9231410f89",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-utilities.css": "2db872a753e7fab2485e7071ce73986d",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-utilities.css.map": "e225cc06e375e43f6620fef824a12450",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-utilities.min.css": "72a3f6b62d70fa00b8a04293b2684b74",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-utilities.min.css.map": "06587e40e7876247697c18585430bf24",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-utilities.rtl.css": "4e911c1cb0c7f5dfe8298e3ba37f2daf",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-utilities.rtl.css.map": "1aec1b75edbf51a4fb0c6303940c2a58",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-utilities.rtl.min.css": "926d6ddf16d43852a8c5b261a1353c6c",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap-utilities.rtl.min.css.map": "3a1df870c0b626c4ca1aa1e54c46c61c",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap.css": "9079e0c709157699c76207a8f30af140",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap.css.map": "d2502083a8e834c521e1ff6278ec2034",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap.min.css": "abe91756d18b7cd60871a2f47c1e8192",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap.min.css.map": "05c873ea810251d6558ca7ddaaf62f90",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap.rtl.css": "40acc52aa8398b8b0623e16eacff9110",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap.rtl.css.map": "b9b8e6715fc1c9965f08a3de53b060ff",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap.rtl.min.css": "b37b1576ded38027a22ee88d08c6c4b5",
"cds_home/bootstrap-5.0.2-dist/css/bootstrap.rtl.min.css.map": "97cc46a370d018dac512c3f1e64a37d0",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.bundle.js": "c06ab2da6717143607610b96f5a6f21f",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.bundle.js.map": "cc88b33cb62c045a00ebcd33ba03e773",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.bundle.min.js": "0aa8d64e726c4a57adb5c88f9115996b",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.bundle.min.js.map": "f9f6b245ee8515fb2a25f4285de8ca26",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.esm.js": "71d099d3ac70ed84f588c8ea68ea9f06",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.esm.js.map": "d2ba8063763d1d14e3ee55e59057c5cc",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.esm.min.js": "44587fa15c50d84a9213e5ea33b7f2a3",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.esm.min.js.map": "a7510a8f35868d5af4b1ff59107b05ef",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.js": "4f47a523586e8e859cef0df6d430ae04",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.js.map": "44172957558c1870e840025a3df91c27",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.min.js": "a08792f518b51f0f1422b5c96df9eb8a",
"cds_home/bootstrap-5.0.2-dist/js/bootstrap.min.js.map": "e9abe61d5c4a3e58dee42da7e9108800",
"cds_home/icons/eye-icon.svg": "2a49454b5c4db824ed1d82838a363ff4",
"cds_home/icons/location-icon.svg": "075773d1c3e1e3666e78bf834992857b",
"cds_home/images/0.jpg": "a59948e35c557f8edb81d7a4dfffade1",
"cds_home/images/0a.jpg": "e4d85c681786e7451ee1eb6f7737a2fa",
"cds_home/images/1.jpg": "28b162b4c567b9b4cda76fe24bdae0b7",
"cds_home/images/2.jpg": "3118b1a18ffe9dc611bcb5c334b2751e",
"cds_home/images/3.jpg": "530aaf26e2ab1971703ef89139b67840",
"cds_home/images/4.jpg": "018a6329aa44fb8c1e178434508db5a7",
"cds_home/images/5.jpg": "0762c9453d5bb4a0a6474ee2f53bd247",
"cds_home/index.html": "285dd18298060f1f2193ae756d2f7442",
"/": "8a79f4389a8977dbbd66e788bf9b00cc",
"cds_home/main.css": "546dc646f7dc7bee7c50fa32ab16e229",
"cds_home/main.js": "4591e0f14e11e55dcbc2f8c6249fff01",
"cds_home/main.json": "fb08488857abc634072edf0e2db5cc83",
"cds_home/pannellum/changelog.md": "76ab3c460713d1694e04b8eb76f610f4",
"cds_home/pannellum/COPYING": "f9cc2991b5cf8165fa9bb1c222e310ef",
"cds_home/pannellum/pannellum.css": "5c2df7d523773c47d9256adf8a95e44d",
"cds_home/pannellum/pannellum.htm": "0c0d6432b005fc3b03213c47b75664d1",
"cds_home/pannellum/pannellum.js": "670b526beaf2e8e501c10eb73beabcc9",
"cds_home/pannellum/readme.md": "c59456251ab41667b3fcb85ba432a0e6",
"cds_home/pannellum/VERSION": "622f0bf1157c543806530ca8a885626a",
"favicon.png": "5dcef449791fa27946b3d35ad8803796",
"flutter.js": "6b515e434cea20006b3ef1726d2c8894",
"icons/Icon-192.png": "ac9a721a12bbc803b44f645561ecb1e1",
"icons/Icon-512.png": "96e752610906ba2a93c65f8abe1645f1",
"icons/Icon-maskable-192.png": "c457ef57daa1d16f64b27b786ec2ea3c",
"icons/Icon-maskable-512.png": "301a7604d45b3e739efc881eb04896ea",
"index.html": "8a79f4389a8977dbbd66e788bf9b00cc",
"main.dart.js": "db68673eb79563b77cacc29e47ff681f",
"manifest.json": "9cbd8c23ee2e3905d84c11585923d8d8",
"version.json": "9a60351f4892c84a7d51f8df841e1b32"};
// The application shell files that are downloaded before a service worker can
// start.
const CORE = ["main.dart.js",
"index.html",
"assets/AssetManifest.json",
"assets/FontManifest.json"];

// During install, the TEMP cache is populated with the application shell files.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  return event.waitUntil(
    caches.open(TEMP).then((cache) => {
      return cache.addAll(
        CORE.map((value) => new Request(value, {'cache': 'reload'})));
    })
  );
});
// During activate, the cache is populated with the temp files downloaded in
// install. If this service worker is upgrading from one with a saved
// MANIFEST, then use this to retain unchanged resource files.
self.addEventListener("activate", function(event) {
  return event.waitUntil(async function() {
    try {
      var contentCache = await caches.open(CACHE_NAME);
      var tempCache = await caches.open(TEMP);
      var manifestCache = await caches.open(MANIFEST);
      var manifest = await manifestCache.match('manifest');
      // When there is no prior manifest, clear the entire cache.
      if (!manifest) {
        await caches.delete(CACHE_NAME);
        contentCache = await caches.open(CACHE_NAME);
        for (var request of await tempCache.keys()) {
          var response = await tempCache.match(request);
          await contentCache.put(request, response);
        }
        await caches.delete(TEMP);
        // Save the manifest to make future upgrades efficient.
        await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
        // Claim client to enable caching on first launch
        self.clients.claim();
        return;
      }
      var oldManifest = await manifest.json();
      var origin = self.location.origin;
      for (var request of await contentCache.keys()) {
        var key = request.url.substring(origin.length + 1);
        if (key == "") {
          key = "/";
        }
        // If a resource from the old manifest is not in the new cache, or if
        // the MD5 sum has changed, delete it. Otherwise the resource is left
        // in the cache and can be reused by the new service worker.
        if (!RESOURCES[key] || RESOURCES[key] != oldManifest[key]) {
          await contentCache.delete(request);
        }
      }
      // Populate the cache with the app shell TEMP files, potentially overwriting
      // cache files preserved above.
      for (var request of await tempCache.keys()) {
        var response = await tempCache.match(request);
        await contentCache.put(request, response);
      }
      await caches.delete(TEMP);
      // Save the manifest to make future upgrades efficient.
      await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
      // Claim client to enable caching on first launch
      self.clients.claim();
      return;
    } catch (err) {
      // On an unhandled exception the state of the cache cannot be guaranteed.
      console.error('Failed to upgrade service worker: ' + err);
      await caches.delete(CACHE_NAME);
      await caches.delete(TEMP);
      await caches.delete(MANIFEST);
    }
  }());
});
// The fetch handler redirects requests for RESOURCE files to the service
// worker cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  var origin = self.location.origin;
  var key = event.request.url.substring(origin.length + 1);
  // Redirect URLs to the index.html
  if (key.indexOf('?v=') != -1) {
    key = key.split('?v=')[0];
  }
  if (event.request.url == origin || event.request.url.startsWith(origin + '/#') || key == '') {
    key = '/';
  }
  // If the URL is not the RESOURCE list then return to signal that the
  // browser should take over.
  if (!RESOURCES[key]) {
    return;
  }
  // If the URL is the index.html, perform an online-first request.
  if (key == '/') {
    return onlineFirst(event);
  }
  event.respondWith(caches.open(CACHE_NAME)
    .then((cache) =>  {
      return cache.match(event.request).then((response) => {
        // Either respond with the cached resource, or perform a fetch and
        // lazily populate the cache only if the resource was successfully fetched.
        return response || fetch(event.request).then((response) => {
          if (response && Boolean(response.ok)) {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    })
  );
});
self.addEventListener('message', (event) => {
  // SkipWaiting can be used to immediately activate a waiting service worker.
  // This will also require a page refresh triggered by the main worker.
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (event.data === 'downloadOffline') {
    downloadOffline();
    return;
  }
});
// Download offline will check the RESOURCES for all files not in the cache
// and populate them.
async function downloadOffline() {
  var resources = [];
  var contentCache = await caches.open(CACHE_NAME);
  var currentContent = {};
  for (var request of await contentCache.keys()) {
    var key = request.url.substring(origin.length + 1);
    if (key == "") {
      key = "/";
    }
    currentContent[key] = true;
  }
  for (var resourceKey of Object.keys(RESOURCES)) {
    if (!currentContent[resourceKey]) {
      resources.push(resourceKey);
    }
  }
  return contentCache.addAll(resources);
}
// Attempt to download the resource online before falling back to
// the offline cache.
function onlineFirst(event) {
  return event.respondWith(
    fetch(event.request).then((response) => {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(event.request, response.clone());
        return response;
      });
    }).catch((error) => {
      return caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response != null) {
            return response;
          }
          throw error;
        });
      });
    })
  );
}
