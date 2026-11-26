/* Where the website sends its requests.
   Today this is the Google Apps Script Web app. After setting up the optional Cloudflare proxy
   (see SECURITY.md), replace the value with the proxy address and the Apps Script address no longer appears anywhere on the site. */
window.SN_CONFIG = {
  api: 'https://script.google.com/macros/s/AKfycbw2DCUcZ41rgRTxeEJd83RI54CKT32RFxJYyy6GCH5Pw8pZmn1-XBJAXOYyRHOebyPh0A/exec'
  ,
  /* Product photos, shown as a round picture next to the colour (tap to enlarge).
     Key = item name | colour, in lower case. Put the file in the photos folder and add a line here. */
  photos: {
    'dotknit|yellow':   'photos/dotknit-yellow.jpg',
    'dotknit|sky blue': 'photos/dotknit-sky-blue.jpg',
    'dotknit|grey':     'photos/dotknit-grey.jpg'
  }
};
