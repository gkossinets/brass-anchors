// The feedback form: a dialog opened by the "Send feedback" link on the front and results pages.
// Messages go to /api/feedback (functions/api/feedback.js); `make feedback` lists them.

const MAX_CHARS = 2000; // server/feedback-core.js MAX_MESSAGE_CHARS

const DIALOG_HTML = `
  <form method="dialog" class="feedback-form">
    <h2 class="panel-title" id="feedback-title">Feedback and suggestions</h2>
    <label for="feedback-message" class="note">What would make the game better? Clips to add, things that confused you, bugs.
      Please don't include your name or contact details.</label>
    <textarea id="feedback-message" rows="6" maxlength="${MAX_CHARS}" required></textarea>
    <!-- Hidden from people; bots that fill in every field give themselves away. -->
    <input class="trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <div class="button-row">
      <button type="submit" class="primary" value="send">Send</button>
      <button type="button" class="secondary" data-close>Cancel</button>
      <span class="note" role="status" id="feedback-status"></span>
    </div>
  </form>`;

/** Wire the "Send feedback" button (#feedback-open) to a dialog; `page` says where it was sent from. */
export function setupFeedback(page) {
  const opener = document.getElementById("feedback-open");
  if (!opener) return;
  const dialog = document.createElement("dialog");
  dialog.className = "feedback-dialog";
  dialog.setAttribute("aria-labelledby", "feedback-title");
  dialog.innerHTML = DIALOG_HTML;
  document.body.append(dialog);

  const form = dialog.querySelector("form");
  const message = dialog.querySelector("#feedback-message");
  const status = dialog.querySelector("#feedback-status");
  const send = dialog.querySelector('button[type="submit"]');
  const cancel = dialog.querySelector("[data-close]");

  opener.onclick = () => {
    status.textContent = "";
    send.hidden = false;
    message.disabled = false;
    cancel.textContent = "Cancel";
    dialog.showModal();
    message.focus();
  };
  cancel.onclick = () => dialog.close();

  form.onsubmit = async (e) => {
    e.preventDefault(); // stay open to show the result
    const text = message.value.trim();
    if (!text) return;
    send.disabled = true;
    status.textContent = "Sending…";
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, page, website: form.elements.website.value }),
      });
      if (!r.ok) throw new Error(r.status === 404 || r.status === 501 ? "not available on this server" : `HTTP ${r.status}`);
      message.value = "";
      message.disabled = true;
      send.hidden = true;
      cancel.textContent = "Close";
      status.textContent = "Thank you! Your message was sent.";
    } catch (err) {
      status.textContent = `Couldn't send it (${err.message}). Please try again later.`;
    } finally {
      send.disabled = false;
    }
  };
}
