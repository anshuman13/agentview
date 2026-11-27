package no.pradhan.agentview.nativeapp.chat

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FreshRepliesTest {
    @Test fun onlyAReplyThatStartsAfterTheChatShowedIsFreshAndOnlyOnce() {
        val f = FreshReplies()
        val user = Item.User("u1", "hi", 0, false, false)
        val old = Item.Assistant("a1", "Hel", true)
        f.update(emptyList())
        f.update(listOf(user, old))
        assertFalse(f.take("a1"))
        f.update(listOf(user, old, Item.Assistant("a2", "Next", true)))
        assertTrue(f.take("a2"))
        assertFalse(f.take("a2"))
        f.update(listOf(user, old, Item.Assistant("a2", "Next words", true)))
        assertFalse(f.take("a2"))
    }
}
