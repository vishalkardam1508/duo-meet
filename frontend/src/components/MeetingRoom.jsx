import { useState } from "react";
import DirectMeetingRoom from "./DirectMeetingRoom.jsx";
import LiveKitMeetingRoom from "./LiveKitMeetingRoom.jsx";

export default function MeetingRoom(props) {
  const [groupMode, setGroupMode] = useState(false);

  if (groupMode) {
    return <LiveKitMeetingRoom {...props} />;
  }

  return <DirectMeetingRoom {...props} onPromote={() => setGroupMode(true)} />;
}
