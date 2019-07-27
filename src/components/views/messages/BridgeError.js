/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { strict as assert } from 'assert';

import React from 'react';
import PropTypes from 'prop-types';
import { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';

import { _t, _td } from '../../../languageHandler';


/**
 * No-op if str is a string, else returns the empty string.
 * @param {Any} str
 * @returns {string}
 */
function assureString(str) {
    return typeof str === 'string' ? str : "";
}

/**
 * No-op if arr is an Array, else returns an empty Array.
 * @param {Any} arr
 * @returns {Array}
 */
function assureArray(arr) {
    return Array.isArray(arr) ? arr : [];
}

// TODO[V02460@gmail.com]: The amount of work for such a simple thing is insane!
class RelationsWatcher {
    constructor(relationType, eventType, mxEvent, room) {
        this.relationType = relationType;
        this.eventType = eventType;

        this.room = room;
        this.mxEvent = mxEvent;
        this.listenersAdded = false;
        this.creationListenerTarget = null;
        this.relations = null;
        this.callbacks = [];

        this._setup(mxEvent, room);
    }

    update(mxEvent, room) {
        this.teardown();
        this._setup(mxEvent, room);
    }

    teardown() {
        if (!this.relations) {
            return;
        }
        this._removeListeners(this.relations);
        this._removeCreationListener();
        // this.callbacks = [];
        this.relations = null;

        assert(!this.listenersAdded);
        assert(!this.creationListenerTarget);
    }

    register(onChangeCallback) {
        this.callbacks.push(onChangeCallback);
    }

    // WATCH REGISTRTION OBJECT CREATION

    _creationCallback = () => {
        this._removeCreationListener();
        this._setup(this.mxEvent, this.room);
    }

    _addCreationListener(mxEvent) {
        mxEvent.on("Event.relationsCreated", this._creationCallback);
        this.creationListenerTarget = mxEvent;
    }

    _removeCreationListener() {
        if (!this.creationListenerTarget) {
            return;
        }
        this.creationListenerTarget.removeListeners(
            "Event.relationsCreated",
            this._creationCallback,
        );
        this.creationListenerTarget = null;
    }

    _setup(mxEvent, room) {
        assert(!this.relations);
        assert(!this.listenersAdded);

        this.relations = this._getRelations(mxEvent, room);

        if (!this.relations) {
            // No setup happened. Wait for relations to appear.
            this._addCreationListener(mxEvent);
            return;
        }
        this._removeCreationListener();

        this._addListeners(this.relations);

        assert(this.listenersAdded);

        this._notify();
    }

    _getRelations(mxEvent, room) {
        const timelineSet = room.getUnfilteredTimelineSet();
        // TODO[V02460]: Correct @returns to Optional in matrix-js-sdk.
        return timelineSet.getRelationsForEvent(
            mxEvent.getId(),
            this.relationType,
            this.eventType,
        );
    }

    _getRelationsEvents() {
        return this.relations.getRelations() || [];
    }

    _notify = () => {
        const ret = this._getRelationsEvents();
        this.callbacks.forEach(callback => callback(ret));
    }

    _addListeners(relations) {
        if (this.listenersAdded) {
            return;
        }
        relations.on("Relations.add", this._notify);
        relations.on("Relations.remove", this._notify);
        relations.on("Relations.redaction", this._notify);
        this.listenersAdded = true;
    }

    _removeListeners(relations) {
        if (!this.listenersAdded) {
            return;
        }
        relations.removeListener("Relations.add", this._notify);
        relations.removeListener("Relations.remove", this._notify);
        relations.removeListener("Relations.redaction", this._notify);
        this.listenersAdded = false;
    }
}

export default class BridgeError extends React.PureComponent {
    static propTypes = {
        mxEvent: PropTypes.instanceOf(MatrixEvent).isRequired,
        room: PropTypes.instanceOf(Room).isRequired,
    };

    constructor(props) {
        super(props);

        /** @type {errorEvents: MatrixEvent[]} */
        this.state = {errorEvents: []};

        this.relationsWatcher = new RelationsWatcher(
            "m.reference",
            "de.nasnotfound.bridge_error",
            props.mxEvent,
            props.room,
        );
        this.relationsWatcher.register((e) => this.setState({errorEvents: e}));
    }

    // componentDidMount() {
    //     this._setupChangeListeners();
    // }

    componentWillUnmount() {
        this.relationsWatcher.teardown();
        // this._teardownChangeListeners();
    }

    componentDidUpdate(prevProps) {
        this.relationsWatcher.update(this.props.mxEvent, this.props.room);
        // this._teardownChangeListeners(prevProps.relations);
        // this._setupChangeListeners();
    }

    // _onErrorEventChange = () => {
    //     this.setState({errorEvents: relations.getRelations()});
    // }

    // async _setupChangeListeners() {
    //     this.relations = await this._getRelations();

    //     this.relations.on("Relations.add", this.onErrorEventChange);
    //     this.relations.on("Relations.remove", this.onErrorEventChange);
    //     this.relations.on("Relations.redaction", this.onErrorEventChange);


    //     this.listeners_added = true;
    //     // Call once for initialization
    //     this._onErrorEventChange();
    // }

    // _teardownChangeListeners(relations) {
    //     relations.removeListener("Relations.add", this.onErrorEventChange);
    //     relations.removeListener("Relations.remove", this.onErrorEventChange);
    //     relations.removeListener("Relations.redaction", this.onErrorEventChange);
    // }

    /**
     * Returns all bridge error relations for this event.
     *
     * @returns {Promise<Relations>}
     */
    async _getRelations() {
        const { mxEvent, room } = this.props;

        // const room = matrixClient.getRoom(mxEvent.getRoomId());
        const timelineSet = room.getUnfilteredTimelineSet();
        return timelineSet.getRelationsForEvent(
            mxEvent.getId(),
            "m.reference",
            "de.nasnotfound.bridge_error",
        );
    }

    /**
     * Returns a list of all users matched by the regex at the time of the event.
     *
     * @param {string} regexStr
     * @returns {RoomMember[]}
     */
    _findMembersFromRegex(regexStr) {
        const { room } = this.props;
        const regex = new RegExp(regexStr);

        // TODO[V02460@gmail.com]: Get room state at the proper point in time
        const roomState = room.getLiveTimeline().getState(EventTimeline.FORWARDS);
        const members = roomState.getMembers();

        return members.filter(m => regex.test(m.userId));
    }

    /**
     * Sanitized infos from a relation.
     * @typedef {Object} RelationInfo
     * @property {RoomMember[]} affectedUsers
     * @property {string} eventID
     * @property {string} networkName
     * @property {string} reason
     */

    /**
     * Returns the network name and the affected users for the given relation.
     *
     * @param {MatrixEvent} relation
     * @returns {RelationInfo}
     */
    _getRelationInfo(relation) {
        const content = relation.getContent();

        const affectedUsersRegex = assureArray(content.affected_users);
        const affectedUsers = affectedUsersRegex.flatMap(u =>
            this._findMembersFromRegex(u),
        );

        return {
            affectedUsers: affectedUsers,
            eventID: assureString(content.event_id),
            networkName: assureString(content.network_name),
            reason: assureString(content.reason),
        };
    }

    _errorMessages = {
        "m.event_not_handled": _td(
            "Not delivered to people on %(networkName)s (%(affectedUsers)s)",
        ),
        "m.event_too_old": _td(
            "It took so long. Gave up sending to people on %(networkName)s " +
            "(%(affectedUsers)s)",
        ),
        "m.internal_error": _td(
            "Unexpected error while sending to people on %(networkName)s " +
            "(%(affectedUsers)s)",
        ),
        "m.foreign_network_error": _td(
            "%(networkName)s did not deliver the message to the people " +
            "there (%(affectedUsers)s)",
        ),
        "m.event_unknown": _td(
            "Was not understood by %(networkName)s, so people there didn't " +
            "get this message (%(affectedUsers)s)",
        ),
    }

    /**
     * Returns an error message for the given reason.
     *
     * Defaults to a generic message if the reason is unknown.
     * @param {string} reason
     * @returns {string}
     */
    _getErrorMessage(reason) {
        return (
            this._errorMessages[reason] || this._errorMessages["m.event_not_handled"]
        );
    }

    /**
     * Returns the rendered element for the given relation.
     *
     * @param {RelationInfo} relationInfo
     * @return {React.Element<'div'>}
     */
    _renderInfo(relationInfo) {
        const usernames = relationInfo.affectedUsers.map(u => u.name).join(", ");
        const message = _t(
            this._getErrorMessage(relationInfo.reason),
            {
                affectedUsers: usernames,
                // count == 0 to add translations for when the network name is missing.
                count: relationInfo.networkName ? 1 : 0,
                networkName: relationInfo.networkName,
            },
        );

        return (
            <div className="mx_BridgeError_message" key={ relationInfo.eventID }>
                { message }
            </div>
        );
    }

    render() {
        const errorEvents = this.state.errorEvents;
        const isBridgeError = !!errorEvents.length;

        if (!isBridgeError) {
            return null;
        }

        const errorInfos = errorEvents.map(e => this._getRelationInfo(e));
        const renderedInfos = errorInfos.map(e => this._renderInfo(e));

        return (
            <div className="mx_BridgeError">
                <div className="mx_BridgeError_icon" />
                { renderedInfos }
            </div>
        );
    }
}
