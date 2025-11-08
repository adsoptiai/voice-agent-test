# Feature: Add Barge-In (User Interrupt) Support to OpenAI Realtime Voice Agent

## Goal
Modify the existing voice agent code (OpenAI Realtime API, either WebRTC or WebSocket mode)
so that the user can **interrupt (barge-in)** the model’s speech mid-response.
When the user starts speaking again, the current model speech output should stop immediately,
and a new response should begin based on the new input.

---

## Requirements

### 1. Detect User Speech During Model Output
- Continuously monitor the **microphone input volume level** or **speech activity**.
- When speech is detected **while the model is speaking**, trigger an interrupt event.

Example (pseudo):
```js
if (isModelSpeaking && userStartsSpeaking()) {
  handleBargeIn();
}
````

---

### 2. Stop Current Model Speech

* If using **WebRTC mode**, call the API’s built-in stop or cancel method, e.g.:

  ```js
  connection.send(JSON.stringify({ type: "response.cancel" }));
  ```
* If using **WebSocket mode**, send the following messages to the Realtime API:

  ```js
  ws.send(JSON.stringify({ type: "response.cancel" }));
  ws.send(JSON.stringify({ type: "response.clear" }));
  ```

This immediately stops the current audio stream from the model.

---

### 3. Clear Pending Audio Buffers

Ensure the outgoing audio queue or TTS buffer is cleared so playback stops immediately:

```js
audioPlayer.stop();
audioPlayer.clearQueue();
```

---

### 4. Start a New Response

Once the user finishes interrupting speech (detected by voice activity ending), send the new input:

```js
ws.send(JSON.stringify({
  type: "response.create",
  instructions: transcribedTextFromUser
}));
```

---

### 5. (Optional) Improve Responsiveness

Add a short debounce (e.g., 300–500 ms) between user speech detection and model cancel,
to avoid false positives during quiet pauses.

---

### 6. Example Implementation Snippet

```js
let isModelSpeaking = false;

function onModelAudioStart() {
  isModelSpeaking = true;
}

function onModelAudioEnd() {
  isModelSpeaking = false;
}

function onUserSpeechDetected() {
  if (isModelSpeaking) {
    ws.send(JSON.stringify({ type: "response.cancel" }));
    ws.send(JSON.stringify({ type: "response.clear" }));
    isModelSpeaking = false;
  }
}

// After user speech stops and transcription is ready:
function onUserUtteranceComplete(transcribedText) {
  ws.send(JSON.stringify({
    type: "response.create",
    instructions: transcribedText
  }));
}
```

---

### 7. Test Plan

* Start conversation and let model speak.
* While it’s speaking, say something new.
* Verify:

  1. Model stops speaking immediately.
  2. Previous audio output is cleared.
  3. New response starts based on latest user input.

---

### 8. Notes

* The Realtime API’s `response.cancel` and `response.create` are the core operations for barge-in.
* For WebRTC, OpenAI SDKs often handle this automatically; for WebSocket, it must be implemented manually.
* Maintain a simple state machine with:

  * `listening`
  * `speaking`
  * `barge-in` (temporary)
  * `idle`

---

## Deliverable

After implementing, the voice agent should:

* Support real-time interruption of model speech.
* Immediately respond to new user queries without waiting for the previous message to finish.
* Avoid overlapping audio or delayed cancellation.
