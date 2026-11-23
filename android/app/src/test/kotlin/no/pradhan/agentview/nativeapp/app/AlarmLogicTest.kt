package no.pradhan.agentview.nativeapp.app

import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Test
import org.junit.Assert.assertEquals

class AlarmLogicTest {
    // Monday 23 November 2026, 10:00 in the phone's zone.
    private val now = ZonedDateTime.of(2026, 11, 23, 10, 0, 0, 0, ZoneId.systemDefault())

    private fun set(hour: Int, minute: Int, days: List<Int> = emptyList(), weekday: String? = null) = AlarmPlan.Set(hour, minute, days, weekday)

    @Test fun noDayIsAnAlarmWithoutDayExtras() {
        assertEquals(set(7, 30), alarmPlan("07:30", null, now))
    }

    @Test fun theNextTimeTheTimeComesRoundNeedsNoDay() {
        assertEquals(set(11, 0), alarmPlan("11:00", "2026-11-23", now))
        assertEquals(set(7, 30), alarmPlan("07:30", "2026-11-24", now))
    }

    @Test fun otherDaysRepeatOnThatWeekday() {
        assertEquals(set(11, 0, listOf(3), "Tuesday"), alarmPlan("11:00", "2026-11-24", now))
        assertEquals(set(7, 30, listOf(1), "Sunday"), alarmPlan("07:30", "2026-11-29", now))
        assertEquals(set(7, 30, listOf(7), "Saturday"), alarmPlan("07:30", "2026-11-28", now))
    }

    @Test fun todayWithTheTimePastIsRefused() {
        assertEquals(AlarmPlan.Refused("time has already passed today"), alarmPlan("07:30", "2026-11-23", now))
    }

    @Test fun aPastDayIsRefused() {
        assertEquals(AlarmPlan.Refused("day is in the past"), alarmPlan("07:30", "2026-11-22", now))
    }

    @Test fun aDayAfterTodayPlusSixIsRefused() {
        assertEquals(AlarmPlan.Refused("day must be within the next 7 days"), alarmPlan("07:30", "2026-12-01", now))
    }

    @Test fun badInputIsRefused() {
        assertEquals(AlarmPlan.Refused("time must be HH:MM (24 h)"), alarmPlan("7:30", null, now))
        assertEquals(AlarmPlan.Refused("day must be YYYY-MM-DD"), alarmPlan("07:30", "tomorrow", now))
    }
}
