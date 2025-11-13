document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const link = $('sx-link')?.textContent?.trim() || '';
  const id = $('sx-id')?.textContent?.trim() || '';
  const pass = $('sx-pass')?.textContent?.trim() || '';

  $('sx-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      alert('Link copied');
    } catch {}
  });

  $('sx-copy-all')?.addEventListener('click', async () => {
    const details = `ScreenX Meeting\nID: ${id}\nPassword: ${pass}\nLink: ${link}`;
    try {
      await navigator.clipboard.writeText(details);
      alert('Details copied');
    } catch {}
  });

  $('sx-share')?.addEventListener('click', async () => {
    const title = 'ScreenX Meeting';
    const text = `Join my ScreenX meeting. ID: ${id}, Pass: ${pass}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: link });
      } else {
        await navigator.clipboard.writeText(`${text}\n\n${link}`);
        alert('Share details copied');
      }
    } catch {}
  });

  // Start Meeting button - prompt for name
  $('sx-start')?.addEventListener('click', () => {
    const userName = prompt('Enter your name to start the meeting:');
    if (userName && userName.trim()) {
      const url = `/meet/${id}?p=${encodeURIComponent(pass)}&name=${encodeURIComponent(userName.trim())}`;
      window.location.href = url;
    } else if (userName !== null) {
      alert('Please enter your name to join the meeting.');
    }
  });
});





