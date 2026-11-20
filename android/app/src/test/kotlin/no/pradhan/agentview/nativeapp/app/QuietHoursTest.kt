package no.pradhan.agentview.nativeapp.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QuietHoursTest {
    private val night = quietWindow("22:00-07:00")
    private fun at(h: Int, m: Int) = h * 60 + m

    @Test fun offAndUnknownPrefsHaveNoWindow() {
        assertNull(quietWindow(""))
        assertNull(quietWindow(null))
        assertNull(quietWindow("21:00-06:00"))
        assertFalse(silentNotice(NoticeKind.Finished, "", at(23, 30), null))
        assertEquals(at(20, 0) to at(8, 0), quietWindow("20:00-08:00"))
    }

    @Test fun finishedIsSilentInsideTheWindow() {
        assertTrue(silentNotice(NoticeKind.Finished, "", at(23, 30), night))
        assertTrue(silentNotice(NoticeKind.Finished, "", at(3, 0), night))
        assertTrue(silentNotice(NoticeKind.Finished, "", at(6, 59), night))
        assertFalse(silentNotice(NoticeKind.Finished, "", at(7, 0), night))
        assertFalse(silentNotice(NoticeKind.Finished, "", at(12, 0), night))
    }

    @Test fun approvalAndFailedKeepTheirSound() {
        assertFalse(silentNotice(NoticeKind.Approval, "", at(23, 30), night))
        assertFalse(silentNotice(NoticeKind.Failed, "", at(23, 30), night))
    }

    @Test fun onlyADoneRoundIsSilent() {
        assertTrue(silentNotice(NoticeKind.Finished, "done", at(23, 30), night))
        for (outcome in listOf("blocked", "question", "failed")) assertFalse(silentNotice(NoticeKind.Finished, outcome, at(23, 30), night))
    }
}
