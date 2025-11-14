document.getElementById('urlForm').addEventListener('submit', function(event) {
    event.preventDefault();
    const url = document.getElementById('urlInput').value;
    // Original encoding inspired by Scramjet base64 codec
    const encodedUrl = '/service/' + btoa(url);
    window.open(encodedUrl, '_blank');
});
