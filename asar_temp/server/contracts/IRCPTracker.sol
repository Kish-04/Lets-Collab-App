// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract IRCPTracker {
    struct SessionLog {
        string sessionId;       // e.g. the Room Code
        string hostId;          // e.g. the email or user ID of the host
        string controllerId;    // e.g. the email or user ID of the controller
        string eventType;       // e.g. "SESSION_START", "ANTI_CHEAT_FLAG", "SESSION_END"
        uint256 timestamp;
        string dataHash;        // IPFS hash or SHA256 string containing more verbose event data
    }

    // Array of all logs generated
    SessionLog[] public logs;

    // Track logs specifically by room/session ID
    mapping(string => uint256[]) public sessionLogIndices;

    event EventLogged(
        string indexed sessionId,
        string eventType,
        string hostId,
        string controllerId,
        uint256 timestamp,
        string dataHash
    );

    // Write a new log to the chain
    function logEvent(
        string memory _sessionId,
        string memory _hostId,
        string memory _controllerId,
        string memory _eventType,
        string memory _dataHash
    ) public {
        uint256 currentTime = block.timestamp;
        
        logs.push(SessionLog({
            sessionId: _sessionId,
            hostId: _hostId,
            controllerId: _controllerId,
            eventType: _eventType,
            timestamp: currentTime,
            dataHash: _dataHash
        }));

        uint256 newIndex = logs.length - 1;
        sessionLogIndices[_sessionId].push(newIndex);

        emit EventLogged(_sessionId, _eventType, _hostId, _controllerId, currentTime, _dataHash);
    }

    // Retrieve the total number of logs recorded globally
    function getGlobalLogCount() public view returns (uint256) {
        return logs.length;
    }

    // Retrieve all logs for an exact session
    function getSessionLogs(string memory _sessionId) public view returns (SessionLog[] memory) {
        uint256[] memory indices = sessionLogIndices[_sessionId];
        SessionLog[] memory result = new SessionLog[](indices.length);
        
        for(uint i = 0; i < indices.length; i++) {
            result[i] = logs[indices[i]];
        }
        
        return result;
    }
}
