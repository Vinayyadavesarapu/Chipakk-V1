const eventService = require('../services/eventService');
const { writeAuditLog } = require('../services/auditService');
const { sendSuccess, sendError } = require('../utils/responseHandler');

/**
 * Get Events List Handler
 * GET /api/admin/events
 */
const getEventsHandler = async (req, res, next) => {
  try {
    const { search, active, event_type, status, limit, offset } = req.query;

    const result = await eventService.getEvents({
      search,
      active,
      event_type,
      status,
      limit,
      offset
    });

    return sendSuccess(res, result, 'Events retrieved successfully');
  } catch (error) {
    console.warn('[Events Optional Handler Fallback]', error.message);
    return sendSuccess(res, { events: [], total: 0, pagination: { total: 0, limit: 50, offset: 0 } }, 'Events fallback');
  }
};

/**
 * Get Event by ID Handler
 * GET /api/admin/events/:id
 */
const getEventByIdHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid event ID format. Expected numeric BIGINT ID.', 400);
    }

    const event = await eventService.getEventById(numId);

    if (!event) {
      return sendError(res, `Event '${id}' not found`, 404);
    }

    return sendSuccess(res, event, 'Event retrieved successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Create Event Handler
 * POST /api/admin/events
 */
const createEventHandler = async (req, res, next) => {
  try {
    const eventData = req.body;

    if (!eventData.name || typeof eventData.name !== 'string' || !eventData.name.trim()) {
      return sendError(res, 'Event name is required.', 400);
    }

    if (!eventData.start_time || !eventData.end_time) {
      return sendError(res, 'Start time and end time are required.', 400);
    }

    const startDate = new Date(eventData.start_time);
    const endDate = new Date(eventData.end_time);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return sendError(res, 'Invalid date format for start_time or end_time.', 400);
    }

    if (endDate < startDate) {
      return sendError(res, 'End time cannot be earlier than start time.', 400);
    }

    const event = await eventService.createEvent(eventData);

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'event.created',
        'event',
        event.id,
        {
          name: event.name,
          event_type: event.event_type,
          start_time: event.start_time,
          end_time: event.end_time,
          discount_percent: event.discount_percent
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, event, 'Event created successfully', 201);
  } catch (error) {
    return next(error);
  }
};

/**
 * Update Event Handler
 * PUT /api/admin/events/:id
 */
const updateEventHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const eventData = req.body;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid event ID format. Expected numeric BIGINT ID.', 400);
    }

    const updatedEvent = await eventService.updateEvent(numId, eventData);

    if (!updatedEvent) {
      return sendError(res, `Event with ID ${id} not found`, 404);
    }

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'event.updated',
        'event',
        numId,
        {
          name: updatedEvent.name,
          active: updatedEvent.active,
          discount_percent: updatedEvent.discount_percent
        }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, updatedEvent, 'Event updated successfully');
  } catch (error) {
    return next(error);
  }
};

/**
 * Delete / Deactivate Event Handler
 * DELETE /api/admin/events/:id
 */
const deleteEventHandler = async (req, res, next) => {
  try {
    const { id } = req.params;

    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      return sendError(res, 'Invalid event ID format. Expected numeric BIGINT ID.', 400);
    }

    const success = await eventService.deleteEvent(numId);

    if (!success) {
      return sendError(res, `Event with ID ${id} not found`, 404);
    }

    // Write audit log if request is from an authenticated admin
    if (req.user && req.user.uid) {
      await writeAuditLog(
        req.user.uid,
        req.user.email || null,
        'event.deactivated',
        'event',
        numId,
        { action: 'deactivated', active: 0 }
      ).catch(err => console.error('[Audit Log Error]', err.message));
    }

    return sendSuccess(res, { deactivated: true, id: numId }, 'Event deactivated successfully');
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getEventsHandler,
  getEventByIdHandler,
  createEventHandler,
  updateEventHandler,
  deleteEventHandler
};
