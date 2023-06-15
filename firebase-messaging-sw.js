// Scripts for firebase and firebase messaging
importScripts("https://www.gstatic.com/firebasejs/8.2.0/firebase-app.js");
importScripts("https://www.gstatic.com/firebasejs/8.2.0/firebase-messaging.js");

// Initialize the Firebase app in the service worker by passing the generated config
const firebaseConfig = {
  apiKey: "AIzaSyAOlH7UATxpQkECzOY6-sXdBIbp_mVCaVg",
  authDomain: "vinhmdev.firebaseapp.com",
  projectId: "vinhmdev",
  storageBucket: "vinhmdev.appspot.com",
  messagingSenderId: "725041116937",
  appId: "1:725041116937:web:9997482cec8716001dc5d8",
  measurementId: "G-TGL9KC57S8"
};

firebase.initializeApp(firebaseConfig);

// Retrieve firebase messaging
const messaging = firebase.messaging();

//messaging.addEventListener('notificationclick', (event) => {
//    console.log('>>>> click ');
//});


messaging.onBackgroundMessage(function(payload) {
    console.log("Received background message ", payload);
//    const notificationTitle = payload.notification.title;
//    const notificationOptions = {
//     body: payload.notification.body,
//     icon: '/icons/512.png'
//    };
//    self.registration.showNotification(notificationTitle, notificationOptions);
});