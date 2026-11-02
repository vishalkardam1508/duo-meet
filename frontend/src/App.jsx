import { useEffect, useRef, useState } from "react";
import EndedPage from "./components/EndedPage.jsx";
import HomePage from "./components/HomePage.jsx";
import LobbyPage from "./components/LobbyPage.jsx";
import MeetingRoom from "./components/MeetingRoom.jsx";
import Navbar from "./components/Navbar.jsx";
import ChatLobbyPage from "./components/ChatLobbyPage.jsx";
import ChatRoomPage from "./components/ChatRoomPage.jsx";
import { meetingCodeFromPath } from "./lib/meeting.js";

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function parseChatPath(pathname) {
  const m = pathname.match(/^\/chat\/([a-z0-9]{4}-[a-z0-9]{4})$/);
  return m ? m[1] : null;
}

export default function App() {
  const pathname = window.location.pathname;
  const isChatLobby = pathname === "/chat";
  const isCallsPage = pathname === "/calls";
  const chatRoomId = parseChatPath(pathname);
  const chatName = new URLSearchParams(window.location.search).get("name") || "";

  const [code, setCode] = useState(() => meetingCodeFromPath(pathname));
  const [page, setPage] = useState(() => (meetingCodeFromPath(pathname) ? "lobby" : "home"));
  const [localStream, setLocalStream] = useState(null);
  const [access, setAccess] = useState(null);
  const [media, setMedia] = useState({ micOn: true, camOn: true });
  const [ended, setEnded] = useState(null);
  const localStreamRef = useRef(localStream);
  localStreamRef.current = localStream;

  useEffect(() => () => stopStream(localStreamRef.current), []);

  useEffect(() => {
    if (isChatLobby || chatRoomId) {
      document.title = chatRoomId ? `Chat ${chatRoomId} | Duo` : "Group Chat | Duo";
    } else {
      document.title = code ? `Meeting ${code} | Duo` : "Duo: group video meetings";
    }
  }, [code, isChatLobby, chatRoomId]);

  const toggleMic = () => {
    setMedia((current) => {
      const micOn = !current.micOn;
      localStream?.getAudioTracks().forEach((track) => { track.enabled = micOn; });
      return { ...current, micOn };
    });
  };

  const toggleCam = () => {
    if (!localStream?.getVideoTracks().length) return;
    setMedia((current) => {
      const camOn = !current.camOn;
      localStream.getVideoTracks().forEach((track) => { track.enabled = camOn; });
      return { ...current, camOn };
    });
  };

  const finishMeeting = (title, text, canRejoin = true) => {
    setEnded({ title, text, canRejoin });
    setPage("ended");
    stopStream(localStream);
    setLocalStream(null);
  };

  const beginMeeting = (meetingAccess, stream) => {
    setAccess(meetingAccess);
    setLocalStream(stream);
    setEnded(null);
    setPage("room");
  };

  // Calls page — coming soon, redirect home with toast
  if (isCallsPage) {
    window.location.replace("/?toast=calls");
    return null;
  }

  // Chat routes
  if (isChatLobby) {
    return (
      <>
        <Navbar />
        <ChatLobbyPage />
      </>
    );
  }

  if (chatRoomId) {
    if (!chatName) {
      window.location.assign("/chat");
      return null;
    }
    return (
      <>
        <Navbar />
        <ChatRoomPage roomId={chatRoomId} name={chatName} />
      </>
    );
  }

  // Meeting routes
  if (page === "lobby" && code) {
    return (
      <LobbyPage
        code={code}
        localStream={localStream}
        setLocalStream={setLocalStream}
        setMedia={setMedia}
        media={media}
        toggleMic={toggleMic}
        toggleCam={toggleCam}
        onJoin={(meetingAccess, stream) => beginMeeting(meetingAccess, stream)}
        onHome={() => {
          stopStream(localStream);
          setLocalStream(null);
          window.location.assign("/");
        }}
      />
    );
  }

  if (page === "room" && code && localStream && access) {
    return (
      <MeetingRoom
        code={code}
        localStream={localStream}
        access={access}
        media={media}
        toggleMic={toggleMic}
        toggleCam={toggleCam}
        hostKey={window.sessionStorage.getItem(`duo-host:${code}`)}
        onEnded={finishMeeting}
      />
    );
  }

  if (page === "ended") {
    return <EndedPage {...ended} />;
  }

  return (
    <>
      <Navbar />
      <HomePage />
    </>
  );
}
